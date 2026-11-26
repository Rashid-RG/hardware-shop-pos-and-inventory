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
  [ordered]@{schema=1;legacyStartup=$legacy;commonStartupPresent=(Test-Path -LiteralPath $commonPath);otherMatchingEntries=$other.Count;launcherDigest=$digest;activationAllowed=$false;automaticStartupAllowed=$false;existingStartupChanged=$false;inventoryScope='startup folders only';blockers=@('Operational stable launcher not activated.','Registry and scheduled task startup sources not yet verified.','Duplicate instance and database writer exclusion require acceptance.')} | ConvertTo-Json -Depth 4
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
