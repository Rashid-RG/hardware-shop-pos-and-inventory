# Opt-in per-user startup; never register a machine-wide service.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
  $root = Split-Path -Parent $PSScriptRoot
  $folder = [Environment]::GetFolderPath('Startup')
  if (-not $folder -or -not (Test-Path -LiteralPath $folder -PathType Container)) { throw 'Windows startup folder not found.' }
  $path = Join-Path $folder 'ARS Distributor POS.lnk'
  $target = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $arguments = '"' + (Join-Path $root 'Launch-Hardware-POS.vbs') + '"'
  $shell = New-Object -ComObject WScript.Shell
  if (Test-Path -LiteralPath $path) {
    $existing = $shell.CreateShortcut($path)
    if ($existing.TargetPath -ine $target -or $existing.Arguments -cne $arguments -or $existing.WorkingDirectory -ine $root) {
      throw 'A different startup shortcut already exists. No shortcut was changed.'
    }
    $answer = [System.Windows.Forms.MessageBox]::Show('Disable automatic ARS startup at Windows login? The desktop launcher and all business data will remain unchanged.','ARS Startup Settings','YesNo','Question')
    if ($answer -eq 'Yes') {
      Remove-Item -LiteralPath $path -ErrorAction Stop
      [void][System.Windows.Forms.MessageBox]::Show('Automatic startup disabled.','ARS Startup Settings','OK','Information')
    }
    return
  }
  foreach ($file in @('.env.local','dist/server.cjs','dist/index.html','Launch-Hardware-POS.vbs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $file) -PathType Leaf)) { throw 'Complete installation and database configuration first.' }
  }
  $answer = [System.Windows.Forms.MessageBox]::Show('Start ARS automatically when you sign into Windows? Enable only after successful manual startup and backup verification.','ARS Startup Settings','YesNo','Question')
  if ($answer -ne 'Yes') { return }
  if (Test-Path -LiteralPath $path) { throw 'Startup shortcut appeared during setup; no existing shortcut was overwritten.' }
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $target
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $root
  $shortcut.Description = 'ARS Distributor POS automatic startup'
  $shortcut.Save()
  [void][System.Windows.Forms.MessageBox]::Show('Automatic startup enabled for this Windows user. Run this utility again to disable it.','ARS Startup Settings','OK','Information')
} catch {
  [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'ARS Startup Settings','OK','Error')
  exit 1
}
