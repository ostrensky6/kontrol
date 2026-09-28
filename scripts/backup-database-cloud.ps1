param(
  [string]$DestinationPath = "D:\Dropbox\Aplicativos\Kontrol\BD",
  [string]$EnvFile = ".env.local",
  [string]$PgDumpPath = $env:PG_DUMP_PATH,
  # Cópia dos arquivos do Storage (anexos, assinaturas): o pg_dump não leva o conteúdo deles.
  [string]$ArquivosPath = "D:DropboxAplicativosKontrolARQUIVOS",
  [switch]$SemArquivos
)

$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param([string]$Path)

  if (!(Test-Path -LiteralPath $Path)) {
    return
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (!$line -or $line.StartsWith("#") -or !$line.Contains("=")) {
      return
    }

    $parts = $line.Split("=", 2)
    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    if ($name) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Get-PgDumpCommand {
  param([string]$ConfiguredPath)

  if ($ConfiguredPath) {
    if (!(Test-Path -LiteralPath $ConfiguredPath)) {
      throw "PG_DUMP_PATH aponta para um arquivo inexistente: $ConfiguredPath"
    }
    return $ConfiguredPath
  }

  $cmd = Get-Command "pg_dump" -ErrorAction SilentlyContinue
  if (!$cmd) {
    throw "pg_dump nao encontrado. Instale PostgreSQL ou configure PG_DUMP_PATH."
  }
  return $cmd.Source
}

Import-DotEnv -Path $EnvFile

$databaseUrl = $env:KONTROL_CLOUD_DATABASE_URL
if (!$databaseUrl) {
  $databaseUrl = $env:DATABASE_URL
}
if (!$databaseUrl) {
  throw "Configure KONTROL_CLOUD_DATABASE_URL no ambiente ou em .env.local com a URL PostgreSQL da nuvem."
}

function Get-PsqlCommand {
  param([string]$PgDump)

  foreach ($nome in @("psql.exe", "psql")) {
    $irmao = Join-Path (Split-Path -Parent $PgDump) $nome
    if (Test-Path -LiteralPath $irmao) {
      return $irmao
    }
  }
  $cmd = Get-Command "psql" -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }
  return $null
}

# Registro em public.backups_execucoes (0134): é o que alimenta o aviso de
# backup atrasado ou com falha em Notificações. Falhar aqui não derruba o backup.
function Register-BackupRun {
  param(
    [string]$Psql,
    [string]$Url,
    [string]$Tipo,
    [string]$Status,
    [datetime]$Inicio,
    [string]$Bytes = "null",
    [string]$Detalhe = ""
  )

  if (!$Psql) {
    Write-Warning "psql nao encontrado: a execucao do backup ($Tipo, $Status) nao foi registrada."
    return
  }
  $origem = "$env:COMPUTERNAME backup-database-cloud"
  $detalheSql = "null"
  if ($Detalhe) {
    $texto = $Detalhe.Substring(0, [Math]::Min(1000, $Detalhe.Length)) -replace "'", "''"
    $detalheSql = "'$texto'"
  }
  $inicioSql = $Inicio.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $sql = "insert into public.backups_execucoes(tipo, status, iniciado_em, concluido_em, tamanho_bytes, origem, detalhe) values ('$Tipo', '$Status', '$inicioSql', now(), $Bytes, '$origem', $detalheSql);"
  try {
    $env:PGCLIENTENCODING = "UTF8"
    & $Psql $Url -X -q -v ON_ERROR_STOP=1 -c $sql | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Nao foi possivel registrar a execucao do backup ($Tipo, $Status)."
    }
  } catch {
    Write-Warning "Nao foi possivel registrar a execucao do backup: $($_.Exception.Message)"
  }
}

$pgDump = Get-PgDumpCommand -ConfiguredPath $PgDumpPath
$psql = Get-PsqlCommand -PgDump $pgDump
New-Item -ItemType Directory -Force -Path $DestinationPath | Out-Null

$inicio = Get-Date
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $DestinationPath "kontrol-db-cloud-$timestamp.dump"

& $pgDump `
  "--format=custom" `
  "--no-owner" `
  "--no-privileges" `
  "--file=$backupPath" `
  $databaseUrl

if ($LASTEXITCODE -ne 0) {
  $codigo = $LASTEXITCODE
  if (Test-Path -LiteralPath $backupPath) {
    Remove-Item -LiteralPath $backupPath -Force
  }
  Register-BackupRun -Psql $psql -Url $databaseUrl -Tipo "banco" -Status "falha" -Inicio $inicio -Detalhe "pg_dump falhou com codigo $codigo em $env:COMPUTERNAME."
  throw "pg_dump falhou com codigo $codigo."
}

$tamanho = (Get-Item -LiteralPath $backupPath).Length
Register-BackupRun -Psql $psql -Url $databaseUrl -Tipo "banco" -Status "ok" -Inicio $inicio -Bytes "$tamanho"

$cutoff = (Get-Date).AddDays(-30)
Get-ChildItem -LiteralPath $DestinationPath -File -Filter "kontrol-db-cloud-*.dump" | ForEach-Object {
  $keepForever = $_.LastWriteTime.Day -eq 1 -or $_.LastWriteTime.Day -eq 15
  $insideWindow = $_.LastWriteTime -ge $cutoff

  if (!$insideWindow -and !$keepForever) {
    Remove-Item -LiteralPath $_.FullName -Force
  }
}

Write-Output "Backup do banco da nuvem criado em $backupPath"

if ($SemArquivos) {
  return
}

# Arquivos do Storage: roda depois do banco; se falhar, o backup do banco vale,
# mas a tarefa termina com erro para aparecer no Agendador e no aviso diário.
$inicioArquivos = Get-Date
$node = Get-Command "node" -ErrorAction SilentlyContinue
if (!$node) {
  Register-BackupRun -Psql $psql -Url $databaseUrl -Tipo "arquivos" -Status "falha" -Inicio $inicioArquivos -Detalhe "node nao encontrado em $env:COMPUTERNAME."
  throw "node nao encontrado: a copia dos arquivos do Storage nao rodou (o backup do banco foi feito)."
}
$storageScript = Join-Path $PSScriptRoot "backup-storage.mjs"
& $node.Source $storageScript --env-file $EnvFile --destino $ArquivosPath
$codigoArquivos = $LASTEXITCODE
if ($codigoArquivos -eq 2) {
  Register-BackupRun -Psql $psql -Url $databaseUrl -Tipo "arquivos" -Status "falha" -Inicio $inicioArquivos -Detalhe "Faltam NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no $EnvFile."
}
if ($codigoArquivos -ne 0) {
  throw "A copia dos arquivos do Storage falhou (codigo $codigoArquivos). O backup do banco foi feito."
}
