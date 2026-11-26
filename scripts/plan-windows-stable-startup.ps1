# Read-only per-user startup migration inventory. Does not enable or remove startup entries.
param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
$root=Split-Path -Parent $PSScriptRoot
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$package=Join-Path $state 'launcher-prepared'
$folder=[Environment]::GetFolderPath('Startup')
$common=[Environment]::GetFolderPath('CommonStartup')
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
function Assert-StartupDirectory([string]$Path) {
  if (-not $Path) { throw 'Startup directory unavailable.' }
  $cursor=$Path
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected startup or package directory.' }
    $cursor=Split-Path -Parent $cursor
  }
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another launcher or maintenance operation is active.' }
  foreach ($dir in @($folder,$common,$package)) { Assert-StartupDirectory $dir }
  $digest=(Assert-ArsPreparedFingerprint $package).digest
  $path=Join-Path $folder 'ARS Distributor POS.lnk'
  $commonPath=Join-Path $common 'ARS Distributor POS.lnk'
  $legacy='absent'
  if (Test-Path -LiteralPath $path) {
    $item=Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid existing startup shortcut.' }
    $shell=New-Object -ComObject WScript.Shell
    $link=$shell.CreateShortcut($path)
    $expectedTarget=Join-Path $env:SystemRoot 'System32\wscript.exe'
    $expectedArguments='"'+(Join-Path $root 'Launch-Hardware-POS.vbs')+'"'
    $legacy=if ($link.TargetPath -ieq $expectedTarget -and $link.Arguments -ceq $expectedArguments -and $link.WorkingDirectory -ieq $root) {'matches-current-installation'} else {'unrecognized'}
  }
  $other=@(Get-ChildItem -LiteralPath $folder,$common -Force | Where-Object { $_.Name -match '(?i)ARS|Hardware.POS|RS.Nextward' -and $_.FullName -ine $path })
  # Report only counts, never unrelated command lines or registry contents.
  $pattern='(?i)ARS[ _.-]*Distributor|hardware[ _.-]*(?:shop[ _.-]*pos|pos)|RS[ _.-]*Nextward|Launch-Hardware-POS'
  $registryMatches=0
  $registryViews=@([Microsoft.Win32.RegistryView]::Registry32)
  if ([Environment]::Is64BitOperatingSystem) { $registryViews+= [Microsoft.Win32.RegistryView]::Registry64 }
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in $registryViews) {
      $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
      try {
        foreach ($sub in @('Software\Microsoft\Windows\CurrentVersion\Run','Software\Microsoft\Windows\CurrentVersion\RunOnce','Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run')) {
          $key=$base.OpenSubKey($sub,$false)
          if ($null -eq $key) { continue }
          try {
            foreach ($name in $key.GetValueNames()) {
              $value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
              if ($name -match $pattern -or ($value -join ' ') -match $pattern) { $registryMatches++ }
            }
          } finally { $key.Dispose() }
        }
      } finally { $base.Dispose() }
    }
  }
  $taskMatches=0
  $startupTaskMatches=0
  foreach ($task in @(Get-ScheduledTask -ErrorAction Stop)) {
    $matched=($task.TaskName -match $pattern -or $task.TaskPath -match $pattern)
    foreach ($action in @($task.Actions)) {
      if (($action.Execute+' '+$action.Arguments+' '+$action.WorkingDirectory) -match $pattern) { $matched=$true }
    }
    if (-not $matched) { continue }
    $taskMatches++
    foreach ($trigger in @($task.Triggers)) {
      if ($trigger.CimClass.CimClassName -in @('MSFT_TaskBootTrigger','MSFT_TaskLogonTrigger')) { $startupTaskMatches++; break }
    }
  }
  [ordered]@{schema=1;legacyStartup=$legacy;commonStartupPresent=(Test-Path -LiteralPath $commonPath);otherMatchingEntries=$other.Count;launcherDigest=$digest;activationAllowed=$false;automaticStartupAllowed=$false;existingStartupChanged=$false;registryMatchingObservations=$registryMatches;matchingScheduledTasks=$taskMatches;matchingBootOrLogonTasks=$startupTaskMatches;inventoryScope='startup folders, Run/RunOnce registry views and visible scheduled tasks';blockers=@('Operational stable launcher not activated.','Inventory is heuristic, not exhaustive; review services, indirect commands and other user accounts separately.','Duplicate instance and database writer exclusion require acceptance.')} | ConvertTo-Json -Depth 4
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
