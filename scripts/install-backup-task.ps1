# Install a daily local backup task for the currently signed-in Windows user.
# Run from PowerShell: powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1
param([string]$Time = '18:00')
$ErrorActionPreference = 'Stop'
if ($Time -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { throw 'Time must use HH:mm in 24-hour format.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $root 'scripts\backup-local.mjs'
if (-not (Test-Path $script)) { throw 'Backup script not found.' }
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $script + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'ARS Daily PostgreSQL Backup' -Action $action -Trigger $trigger -Settings $settings -Description 'Daily verified local ARS PostgreSQL backup; computer must be on with Docker running.' -Force | Out-Null
Write-Host 'Scheduled daily backup at' $Time
Write-Host 'Run a manual trial before relying on schedule: node scripts/backup-local.mjs'
Write-Host 'Inspect Task Scheduler history and back up the backups folder to an external encrypted drive.'
