# Install a separate recovery shortcut from the existing trusted application installation.
param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
. (Join-Path $PSScriptRoot 'windows-runtime-paths.ps1')
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$package=Split-Path -Parent $PSScriptRoot
if ($null -ne [Environment]::GetEnvironmentVariable('ARS_RUNTIME_ROOT','Process')) { throw 'External runtime shortcut requires a separately reviewed launcher.' }
$null=Get-ArsWindowsRuntimeRoot $package
$desktop=[Environment]::GetFolderPath('Desktop')
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
$temp=$null
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another launcher or maintenance operation is active.' }
  if (-not $desktop) { throw 'Desktop folder unavailable.' }
  foreach ($dir in @($package,$desktop)) {
    $cursor=$dir
    while ($cursor) {
      $item=Get-Item -LiteralPath $cursor -Force
      if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected shortcut or package directory.' }
      $cursor=Split-Path -Parent $cursor
    }
  }
  $path=Join-Path $desktop 'ARS Distributor - Recovery Center.lnk'
  if (Test-Path -LiteralPath $path) { throw 'Recovery shortcut already exists. No shortcut was replaced.' }
  $entry=Join-Path $package 'scripts\show-windows-recovery-center.ps1'
  $files=@($entry,(Join-Path $package 'scripts\writer-loss-offline-diagnostics.mjs'))
  $hashes=@{}
  foreach ($file in $files) {
    $item=Get-Item -LiteralPath $file -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid recovery entry point.' }
    $hashes[$file]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  }
  $answer=[Windows.Forms.MessageBox]::Show('Create a separate read-only Recovery Center shortcut for this installation? It will not start the POS or change automatic startup.','ARS Distributor | RS Nextward','YesNo','Question')
  if ($answer -ne 'Yes') { return }
  foreach ($file in $files) { if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne $hashes[$file]) { throw 'Recovery entry changed during confirmation.' } }
  $temp=Join-Path $desktop ('.ars-recovery-'+[guid]::NewGuid().ToString('N')+'.lnk')
  $shell=New-Object -ComObject WScript.Shell
  $shortcut=$shell.CreateShortcut($temp)
  $shortcut.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments='-NoProfile -STA -WindowStyle Hidden -File "'+$entry+'"'
  $shortcut.WorkingDirectory=$package
  $shortcut.Description='RS Nextward - ARS read-only recovery diagnostics'
  $shortcut.Save()
  # File.Move refuses to replace an existing destination.
  [IO.File]::Move($temp,$path)
  $temp=$null
  [void][Windows.Forms.MessageBox]::Show('Recovery Center shortcut created. Existing POS shortcut is unchanged. A registered database binding is required.','ARS Distributor | RS Nextward','OK','Information')
} catch {
  [void][Windows.Forms.MessageBox]::Show('Recovery shortcut could not be installed. Existing POS startup was not changed. Contact RS Nextward support.','ARS Distributor | RS Nextward','OK','Error')
  throw
} finally {
  if ($temp -and (Test-Path -LiteralPath $temp -PathType Leaf)) { Remove-Item -LiteralPath $temp -Force }
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
