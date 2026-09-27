param(
  [string]$ProjectPath = "G:\Aplicativos\Kontrol",
  [string]$DestinationPath = "D:\Dropbox\Aplicativos\Kontrol\BD",
  [string]$TaskName = "Kontrol - Backup banco nuvem",
  [string]$RunAsUser = $env:USERNAME
)

$ErrorActionPreference = "Stop"

$project = (Resolve-Path -LiteralPath $ProjectPath).Path
$scriptPath = Join-Path $project "scripts\backup-database-cloud.ps1"

if (!(Test-Path -LiteralPath $scriptPath)) {
  throw "Script de backup nao encontrado: $scriptPath"
}

$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -DestinationPath `"$DestinationPath`" -EnvFile `"$project\.env.local`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument -WorkingDirectory $project
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At "00:30"),
  (New-ScheduledTaskTrigger -Daily -At "12:30")
)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal `
  -UserId $RunAsUser `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description "Backup automatico do banco de dados em nuvem do Kontrol, salvo localmente." `
  -Force | Out-Null

Write-Output "Tarefa '$TaskName' registrada para 00:30 e 12:30."
