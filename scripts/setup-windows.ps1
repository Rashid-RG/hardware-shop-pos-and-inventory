# Prepare a fresh Windows checkout; existing configurations require the approved manual update procedure.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $root = Split-Path -Parent $PSScriptRoot
  Set-Location -LiteralPath $root
  if (Test-Path -LiteralPath '.env.local') { throw 'Existing configuration detected. Use the documented backup and update procedure; this fresh setup will not modify it.' }
  if (Test-Path -LiteralPath 'dist/server.cjs') { throw 'An existing build was found. Fresh setup will not replace it.' }
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 3000 is occupied. No process was stopped.' }
  foreach ($tool in @('node','npm.cmd','docker')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool before continuing." }
  }
  & node -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)'
  if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or newer is required.' }
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { throw 'Windows desktop folder not found.' }
  $shortcutPath = Join-Path $desktop 'ARS Distributor POS.lnk'
  if (Test-Path -LiteralPath $shortcutPath) { throw 'An ARS desktop shortcut already exists. No shortcut was overwritten.' }
  $answer = [System.Windows.Forms.MessageBox]::Show('Prepare this fresh checkout for ARS Distributor? Dependencies and a production build will be installed. Database configuration and startup remain separate.','ARS Distributor Setup','YesNo','Question')
  if ($answer -ne 'Yes') { return }
  & npm.cmd ci --include=dev
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath 'dist/server.cjs' -PathType Leaf) -or -not (Test-Path -LiteralPath 'dist/index.html' -PathType Leaf)) { throw 'Production build failed.' }
  if ((Test-Path -LiteralPath '.env.local') -or (Test-Path -LiteralPath $shortcutPath)) { throw 'Configuration or shortcut appeared during setup. No shortcut was replaced.' }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $shortcut.Arguments = '"' + (Join-Path $root 'Launch-Hardware-POS.vbs') + '"'
  $shortcut.WorkingDirectory = $root
  $shortcut.Description = 'ARS Distributor POS - RS Nextward'
  $shortcut.Save()
  [void][System.Windows.Forms.MessageBox]::Show('Production build and desktop shortcut prepared. Configure the intended PostgreSQL database and a strong JWT_SECRET using the Windows opening checklist before launching. No database was started or modified.','ARS Distributor Setup','OK','Information')
} catch {
  [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'ARS Distributor Setup','OK','Error')
  exit 1
}
