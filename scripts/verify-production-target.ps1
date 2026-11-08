param(
  [switch]$AllowNonMain
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Expected = @{
  VercelOrgId = "team_N5uHkBDu4hLjI9Yx2gmtpg4L"
  VercelProjectId = "prj_3l6QuGqsG63Lna4pTZ5Di1vV8RZc"
  VercelScope = "giaufpr"
  VercelTeamName = "Gia"
  VercelProject = "kontrol"
  ProductionUrl = "https://kontrol-atgc.vercel.app"
  SupabaseRef = "gkcjzwfsnoknxgpsumxi"
  SupabaseUrl = "https://gkcjzwfsnoknxgpsumxi.supabase.co"
}

$Failures = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]

function Add-Failure([string]$Message) {
  $Failures.Add($Message) | Out-Null
}

function Add-Warning([string]$Message) {
  $Warnings.Add($Message) | Out-Null
}

function Read-DotEnv([string]$Path) {
  $values = @{}
  if (!(Test-Path $Path)) {
    return $values
  }

  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') {
      $values[$matches[1]] = $matches[2].Trim('"').Trim("'")
    }
  }
  return $values
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot
try {
  $branch = (git branch --show-current).Trim()
  if (!$AllowNonMain -and $branch -ne "main") {
    Add-Failure "Branch atual '$branch' nao e 'main'. Use main para producao ou rode com -AllowNonMain conscientemente."
  }

  $vercelProjectPath = Join-Path $repoRoot ".vercel/project.json"
  if (!(Test-Path $vercelProjectPath)) {
    Add-Failure "Projeto Vercel nao esta linkado: .vercel/project.json ausente."
  } else {
    $vercelProject = Get-Content -Raw $vercelProjectPath | ConvertFrom-Json
    if ($vercelProject.orgId -ne $Expected.VercelOrgId) {
      Add-Failure ".vercel/project.json orgId='$($vercelProject.orgId)', esperado '$($Expected.VercelOrgId)'."
    }
    if ($vercelProject.projectId -ne $Expected.VercelProjectId) {
      Add-Failure ".vercel/project.json projectId='$($vercelProject.projectId)', esperado '$($Expected.VercelProjectId)'."
    }
  }

  $supabaseProjectRefPath = Join-Path $repoRoot "supabase/.temp/project-ref"
  if (!(Test-Path $supabaseProjectRefPath)) {
    Add-Failure "Supabase nao esta linkado. Rode: supabase link --project-ref $($Expected.SupabaseRef)"
  } else {
    $linkedRef = (Get-Content -Raw $supabaseProjectRefPath).Trim()
    if ($linkedRef -ne $Expected.SupabaseRef) {
      Add-Failure "Supabase linkado em '$linkedRef', esperado '$($Expected.SupabaseRef)'."
    }
  }

  $envLocal = Read-DotEnv (Join-Path $repoRoot ".env.local")
  if ($envLocal.ContainsKey("NEXT_PUBLIC_SUPABASE_URL") -and $envLocal["NEXT_PUBLIC_SUPABASE_URL"] -ne $Expected.SupabaseUrl) {
    Add-Warning ".env.local NEXT_PUBLIC_SUPABASE_URL aponta para '$($envLocal["NEXT_PUBLIC_SUPABASE_URL"])'. Isso e normal para desenvolvimento local; confirme as env vars Production na Vercel antes do deploy."
  }

  $migrationFiles = Get-ChildItem (Join-Path $repoRoot "supabase/migrations") -Filter "*.sql"
  $versions = $migrationFiles | ForEach-Object {
    if ($_.Name -match '^(\d{4})_') {
      [pscustomobject]@{ Version = $matches[1]; Name = $_.Name }
    }
  }

  $duplicates = $versions | Group-Object Version | Where-Object { $_.Count -gt 1 }
  foreach ($duplicate in $duplicates) {
    $names = ($duplicate.Group | ForEach-Object { $_.Name }) -join ", "
    Add-Failure "Versao de migration duplicada '$($duplicate.Name)': $names"
  }

  if (Test-Path (Join-Path $repoRoot "supabase/migrations/0026_pedido_compra_recebida.sql")) {
    Add-Failure "Migration 0026_pedido_compra_recebida.sql nao deve existir; ela deve ser 0032_pedido_compra_recebida.sql para evitar versao duplicada."
  }

  if (!(Test-Path (Join-Path $repoRoot "supabase/migrations/0032_pedido_compra_recebida.sql"))) {
    Add-Failure "Migration esperada ausente: supabase/migrations/0032_pedido_compra_recebida.sql"
  }

  if ($env:VERCEL_TOKEN) {
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $inspect = & vercel project inspect $Expected.VercelProject --scope $Expected.VercelScope --token $env:VERCEL_TOKEN 2>&1
    $ErrorActionPreference = $oldEap
    $inspectText = $inspect -join "`n"
    if ($LASTEXITCODE -ne 0) {
      Add-Failure "Token Vercel nao acessa $($Expected.VercelScope)/$($Expected.VercelProject)."
    } elseif ($inspectText -notmatch [regex]::Escape($Expected.VercelProjectId)) {
      Add-Failure "Vercel project inspect nao confirmou o Project ID esperado '$($Expected.VercelProjectId)'."
    }
  } else {
    Add-Warning "VERCEL_TOKEN nao definido; validacao remota da Vercel foi pulada."
  }

  # Rastreabilidade: o que o dominio oficial esta servindo agora (versao,
  # commit e migration esperada). So leitura; nao falha se a rota ainda nao existir.
  $NoAr = $null
  try {
    $NoAr = Invoke-RestMethod -Uri "$($Expected.ProductionUrl)/api/versao" -TimeoutSec 15
  } catch {
    Add-Warning "Nao consegui ler $($Expected.ProductionUrl)/api/versao (publicacao anterior a 1.5.9 ou fora do ar)."
  }
  if ($NoAr) {
    $headLocal = (git rev-parse HEAD).Trim()
    if ($NoAr.commit -and $NoAr.commit -ne $headLocal) {
      Add-Warning "Producao serve o commit $($NoAr.commit) (versao $($NoAr.versao)); a pasta local esta em $headLocal."
    }
  }

  if ($Warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "Avisos:" -ForegroundColor Yellow
    foreach ($warning in $Warnings) {
      Write-Host " - $warning" -ForegroundColor Yellow
    }
  }

  if ($Failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Falha na validacao de producao:" -ForegroundColor Red
    foreach ($failure in $Failures) {
      Write-Host " - $failure" -ForegroundColor Red
    }
    exit 1
  }

  Write-Host "Validacao de producao OK:" -ForegroundColor Green
  Write-Host " - Vercel: $($Expected.VercelTeamName) [$($Expected.VercelScope)]/$($Expected.VercelProject) -> $($Expected.ProductionUrl)"
  Write-Host " - Supabase: $($Expected.SupabaseRef)"
  Write-Host " - Migrations: sem versoes duplicadas"
  if ($NoAr) {
    Write-Host " - No ar: versao $($NoAr.versao), commit $($NoAr.commit), migration esperada $($NoAr.migration_esperada) (confira com db:migration --situacao)"
  }
} finally {
  Pop-Location
}
