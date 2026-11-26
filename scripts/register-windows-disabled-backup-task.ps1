# Register only a disabled readiness task. Never execute or enable it.
param()
$ErrorActionPreference='Stop'
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$package=Join-Path $state 'launcher-prepared'
$name='ARS Distributor - Stable Encrypted Backup'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
function Verify-Proposal {
  $result=(@(& (Join-Path $PSScriptRoot 'prepare-windows-backup-schedule.ps1') -Verify) -join [Environment]::NewLine) | ConvertFrom-Json
  if ($result.schema -ne 1 -or $result.scheduleMatched -ne $true -or $result.schedulingAllowed -ne $false -or $result.uploadAllowed -ne $false -or $result.dailyLocalTime -cnotmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { throw 'Inactive schedule proposal verification failed.' }
  return $result
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another launcher or maintenance operation is active.' }
  $first=Verify-Proposal
  if ((Read-Host 'Type REGISTER DISABLED BACKUP TASK to create a disabled readiness task') -cne 'REGISTER DISABLED BACKUP TASK') { return }
  $second=Verify-Proposal
  if (($first | ConvertTo-Json -Compress) -cne ($second | ConvertTo-Json -Compress)) { throw 'Schedule proposal changed.' }
  $service=New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $folder=$service.GetFolder('\')
  # TASK_CREATE (2), not TASK_CREATE_OR_UPDATE (6): conflicts cannot overwrite a task.
  $definition=$service.NewTask(0)
  $definition.RegistrationInfo.Description='RS Nextward / ARS Distributor inactive backup readiness task; no backup execution.'
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $definition.Principal.UserId=$sid
  $definition.Principal.LogonType=3
  $definition.Principal.RunLevel=0
  $definition.Settings.Enabled=$false
  $definition.Settings.AllowDemandStart=$false
  $definition.Settings.StartWhenAvailable=$true
  $definition.Settings.MultipleInstances=2
  $definition.Settings.ExecutionTimeLimit='PT15M'
  $trigger=$definition.Triggers.Create(2)
  $trigger.StartBoundary=([DateTime]::Today.ToString('yyyy-MM-dd')+'T'+$second.dailyLocalTime+':00')
  $trigger.DaysInterval=1
  $trigger.Enabled=$false
  $action=$definition.Actions.Create(0)
  $action.Path=Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\powershell.exe'
  $action.Arguments='-NoProfile -NonInteractive -File "'+(Join-Path $package 'scripts\preview-windows-stable-backup.ps1')+'"'
  $action.WorkingDirectory=$package
  $registered=$folder.RegisterTaskDefinition($name,$definition,2,$sid,$null,3,$null)
  $observed=$folder.GetTask($name)
  if ($observed.Enabled -or $observed.Definition.Settings.Enabled -or $observed.Definition.Settings.AllowDemandStart -or $observed.Definition.Triggers.Count -ne 1 -or $observed.Definition.Triggers.Item(1).Enabled -or $observed.Definition.Actions.Count -ne 1 -or $observed.Definition.Actions.Item(1).Arguments -cne $action.Arguments -or $observed.Definition.Actions.Item(1).Path -ine $action.Path) { throw 'Registered task differs from inactive definition. Review Task Scheduler before proceeding.' }
  [ordered]@{schema=1;taskRegistered=$true;taskEnabled=$false;triggerEnabled=$false;manualStartAllowed=$false;backupStarted=$false;uploadAllowed=$false;existingTasksChanged=$false} | ConvertTo-Json
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
