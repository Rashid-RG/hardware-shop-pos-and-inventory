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
function Assert-Fresh {
 foreach ($name in @('.env.local','uploads','backups')) {
  if (Test-Path -LiteralPath (Join-Path $root $name)) { throw 'Existing runtime detected. Fresh setup is blocked.' }
 }
 $state = Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
 if (Test-Path -LiteralPath $state) { throw 'Existing installation or recovery state detected. Contact support.' }
 foreach ($tool in @('node','npm.cmd','docker')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing prerequisite: $tool." }
 }
 Invoke-Checked 'node' @('-e',"const [a,b]=process.versions.node.split('.').map(Number);if(a!==22||b<12)process.exit(1)")
 Invoke-Checked 'docker' @('info','--format','{{.ServerVersion}}')
 Invoke-Checked 'docker' @('compose','version')
 $volumes = @(docker volume ls --format '{{.Name}}')
 if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker volumes.' }
 if ($volumes | Where-Object { $_ -match 'hardware_pos_pgdata|ars-mint' }) { throw 'Existing ARS database volume detected. No setup changes made.' }
 $containers = @(docker ps -a --format '{{.Names}}')
 if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker containers.' }
 if ($containers -contains 'hardware-pos-postgres') { throw 'Existing ARS container detected.' }
 if (Get-NetTCPConnection -LocalPort 3000,5433 -State Listen -ErrorAction SilentlyContinue) { throw 'Required local ports are already occupied.' }
}
try {
 try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true }
 if (-not $owned) { return }
 Set-Location -LiteralPath $root
 if (-not (Confirm-Step ('Thank you for choosing RS Nextward.'+[Environment]::NewLine+'Welcome to ARS Distributor 1.0 Pilot Setup. Internet access, Node.js 22.12+ and running Docker Desktop are required.'))) { return }
 $terms=Get-Content -LiteralPath (Join-Path $root 'docs\pilot-installation-terms.txt') -Raw
 if ([System.Windows.Forms.MessageBox]::Show(($terms+[Environment]::NewLine+'Do you accept these pilot installation conditions?'),$title,'YesNo','Question') -ne 'Yes') { return }
 Assert-Fresh
 if (-not (Confirm-Step ('Prepare the application in the extracted folder? '+$root+[Environment]::NewLine+'Keep this folder permanently. This stage prepares a production build only.'))) { return }
 Assert-Fresh
 Invoke-Checked 'npm.cmd' @('ci','--include=dev')
 Invoke-Checked 'npm.cmd' @('run','build')
 Assert-Fresh
 # Do not provision or start the legacy Compose database with its default password.
 [void][System.Windows.Forms.MessageBox]::Show('Application build prepared successfully. Secure Windows database provisioning is not yet enabled in this pilot wizard. No database or configuration was created.',$title,'OK','Information')
} catch {
 [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,$title,'OK','Error')
 exit 1
} finally {
 if ($owned) { $mutex.ReleaseMutex() }
 $mutex.Dispose()
}
