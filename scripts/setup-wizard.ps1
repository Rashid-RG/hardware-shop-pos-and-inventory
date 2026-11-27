# Fresh Windows pilot preparation only. Never updates an existing installation.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$root = Split-Path -Parent $PSScriptRoot
$title = 'RS Nextward | ARS Distributor Setup'
$mutex = New-Object System.Threading.Mutex($false,'Local\ARSDistributorFreshSetup')
$owned = $false
function Confirm-Step([string]$message) {
 return [System.Windows.Forms.MessageBox]::Show($message,$title,'OKCancel','Information') -eq 'OK'
}
function Invoke-Checked([string]$program,[string[]]$arguments) {
 & $program @arguments
 if ($LASTEXITCODE -ne 0) { throw "$program failed (exit $LASTEXITCODE)." }
}
function New-Secret {
 $bytes = New-Object byte[] 48
 $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
 try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
 return [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
}
function Assert-FreshFiles {
 foreach ($name in @('.env.local','uploads','backups')) {
  if (Test-Path -LiteralPath (Join-Path $root $name)) { throw 'Existing runtime detected. Fresh setup is blocked.' }
 }
 $state = Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
 if (Test-Path -LiteralPath $state) { throw 'Existing installation or recovery state detected. Contact support.' }
 foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('Programs'))) {
  if (Test-Path -LiteralPath (Join-Path $folder 'ARS Distributor.lnk')) { throw 'Existing shortcut detected. Fresh setup is blocked.' }
 }
}
function Assert-Fresh {
 Assert-FreshFiles
 foreach ($tool in @('node','npm.cmd','docker')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing prerequisite: $tool." }
 }
 Invoke-Checked 'node' @('-e',"const [a,b]=process.versions.node.split('.').map(Number);if(a!==22||b<12)process.exit(1)")
 Invoke-Checked 'docker' @('info','--format','{{.ServerVersion}}')
 Invoke-Checked 'docker' @('compose','version')
 $volumes = @(docker volume ls --format '{{.Name}}')
 if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker volumes.' }
 if ($volumes | Where-Object { $_ -match 'hardware_pos_pgdata|ars-mint|ars-windows-pilot' }) { throw 'Existing ARS database volume detected. No setup changes made.' }
 $containers = @(docker ps -a --format '{{.Names}}')
 if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker containers.' }
 if ($containers -contains 'hardware-pos-postgres' -or $containers -contains 'ars-windows-pilot-postgres') { throw 'Existing ARS container detected.' }
 if (Get-NetTCPConnection -LocalPort 3000,5433 -State Listen -ErrorAction SilentlyContinue) { throw 'Required local ports are already occupied.' }
}
try {
 try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true }
 if (-not $owned) { return }
 Set-Location -LiteralPath $root
 . (Join-Path $PSScriptRoot 'windows-setup-resume.ps1')
 Consume-ArsSetupResume
 . (Join-Path $PSScriptRoot 'windows-setup-ui.ps1')
 if (-not (Show-ArsSetupPage 'Welcome to Setup' ('Thank you for choosing RS Nextward.'+[Environment]::NewLine+'Welcome to ARS Distributor 1.0 Pilot Setup. Internet access is required. Setup checks Node.js 22 and Docker Desktop and can install missing components.'))) { return }
 Assert-FreshFiles
 $terms=Get-Content -LiteralPath (Join-Path $root 'docs\pilot-installation-terms.txt') -Raw
 if (-not (Show-ArsSetupPage 'Installation agreement' $terms 'Accept and continue' -Agreement)) { return }
 . (Join-Path $PSScriptRoot 'windows-prerequisites.ps1')
 if (-not (Install-ArsMissingPrerequisites)) { return }
 Assert-Fresh
 if (-not (Show-ArsSetupPage 'Ready to install' ('Prepare the application in the extracted folder? '+$root+[Environment]::NewLine+'Keep this folder permanently. This stage builds the application and prepares a fresh private database.'))) { return }
 Assert-Fresh
 Open-ArsProgress
 Set-ArsProgress 0 'Installing locked application dependencies...'
 Invoke-Checked 'npm.cmd' @('ci','--include=dev')
 Set-ArsProgress 1 'Building the production application...'
 Invoke-Checked 'npm.cmd' @('run','build')
 Assert-Fresh
 Set-ArsProgress 2 'Preparing private database credentials...'
 # Create configuration exclusively. Never replace credentials or use legacy defaults.
 $password=New-Secret
 $jwt=New-Secret
 $config=Join-Path $root '.env.local'
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $acl=New-Object Security.AccessControl.FileSecurity
 $acl.SetAccessRuleProtection($true,$false)
 $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')
 $acl.AddAccessRule($rule)
 $stream=[IO.File]::Open($config,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try {
  $stream.SetAccessControl($acl)
  $lines=@('ARS_WINDOWS_PILOT=1',"ARS_WINDOWS_DB_PASSWORD=$password","DATABASE_URL=postgresql://ars:$password@127.0.0.1:5433/hardware_pos_ars","JWT_SECRET=$jwt")
  $data=[Text.Encoding]::UTF8.GetBytes(($lines -join [Environment]::NewLine)+[Environment]::NewLine)
  $stream.Write($data,0,$data.Length)
 } finally { $stream.Dispose() }
 Set-ArsProgress 3 'Downloading and starting PostgreSQL...'
 # Separate Compose project and loopback-only port. No deletion on failure.
 Invoke-Checked 'docker' @('compose','-p','ars-windows-pilot','--env-file','.env.local','-f','scripts/windows-pilot-compose.yml','up','-d','--wait')
 Set-ArsProgress 4 'Creating desktop and Start menu shortcuts...'
 # Create user shortcuts only if no existing shortcut would be overwritten.
 $desktop=[Environment]::GetFolderPath('DesktopDirectory')
 $programs=[Environment]::GetFolderPath('Programs')
 $shell=New-Object -ComObject WScript.Shell
 foreach ($folder in @($desktop,$programs)) {
  $link=Join-Path $folder 'ARS Distributor.lnk'
  if (Test-Path -LiteralPath $link) { throw 'Existing ARS shortcut detected. Retain it and contact support.' }
  $shortcut=$shell.CreateShortcut($link)
  $shortcut.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe'
  $shortcut.Arguments='"'+(Join-Path $root 'Launch-Hardware-POS.vbs')+'"'
  $shortcut.WorkingDirectory=$root
  $shortcut.Description='ARS Distributor | RS Nextward'
  $shortcut.Save()
 }
 Set-ArsProgress 5 'Setup steps completed.'
 Close-ArsProgress
 if (Show-ArsSetupPage 'Setup completed' 'Thank you for choosing RS Nextward. Launch ARS to verify readiness and register the first administrator.' 'Launch ARS') {
  Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"'+(Join-Path $root 'Launch-Hardware-POS.vbs')+'"')
 }
} catch {
 if (Get-Command Close-ArsProgress -ErrorAction SilentlyContinue) { Close-ArsProgress }
 [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,$title,'OK','Error')
 exit 1
} finally {
 if ($owned) { $mutex.ReleaseMutex() }
 $mutex.Dispose()
}
