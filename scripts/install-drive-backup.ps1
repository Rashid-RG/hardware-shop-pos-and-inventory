param([ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$At = '20:00')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -CommandType Application).Source
Get-Command rclone.exe -CommandType Application | Out-Null
$name = 'ARS Hardware - Daily Drive Backup'
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $PSScriptRoot 'drive-backup.mjs') + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.Add([timespan]::Parse($At)))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Scheduled for $At local time under $user. Stay signed in and keep Docker available."
Write-Host "To run the first backup now: Start-ScheduledTask -TaskName '$name'"
