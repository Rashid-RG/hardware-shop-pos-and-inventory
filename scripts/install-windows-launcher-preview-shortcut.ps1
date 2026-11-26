# Install only a separately named readiness preview shortcut. Never replace the POS shortcut.
param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$package=Join-Path $state 'launcher-prepared'
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
  $path=Join-Path $desktop 'ARS Distributor - Readiness Preview.lnk'
  if (Test-Path -LiteralPath $path) { throw 'Preview shortcut already exists. No shortcut was replaced.' }
  $digest=(Assert-ArsPreparedFingerprint $package).digest
  $entry=Join-Path $package 'scripts\show-windows-launcher-preview.ps1'
  if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Prepared graphical launcher is missing.' }
  $answer=[Windows.Forms.MessageBox]::Show('Create a separate readiness preview shortcut? It will not start the POS, enable automatic startup or activate any release.','ARS Distributor | RS Nextward','YesNo','Question')
  if ($answer -ne 'Yes') { return }
  if ((Assert-ArsPreparedFingerprint $package).digest -cne $digest) { throw 'Launcher package changed during confirmation.' }
  $temp=Join-Path $desktop ('.ars-preview-'+[guid]::NewGuid().ToString('N')+'.lnk')
  $shell=New-Object -ComObject WScript.Shell
  $shortcut=$shell.CreateShortcut($temp)
  $shortcut.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments='-NoProfile -STA -WindowStyle Hidden -File "'+$entry+'"'
  $shortcut.WorkingDirectory=$package
  $shortcut.Description='RS Nextward - ARS readiness preview only'
  $shortcut.Save()
  # File.Move refuses to replace an existing destination.
  [IO.File]::Move($temp,$path)
  $temp=$null
  [void][Windows.Forms.MessageBox]::Show('Readiness preview shortcut created. Existing POS shortcut is unchanged. Explicit runtime selection is still required for verification.','ARS Distributor | RS Nextward','OK','Information')
} catch {
  [void][Windows.Forms.MessageBox]::Show('Preview shortcut could not be installed. Existing POS startup was not changed. Contact RS Nextward support.','ARS Distributor | RS Nextward','OK','Error')
  throw
} finally {
  if ($temp -and (Test-Path -LiteralPath $temp -PathType Leaf)) { Remove-Item -LiteralPath $temp -Force }
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
