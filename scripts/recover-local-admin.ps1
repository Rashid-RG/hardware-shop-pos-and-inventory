$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

Write-Host 'ARS Hardware POS - Local Administrator Password Recovery' -ForegroundColor Cyan
Write-Host 'This changes only the password of an EXISTING Super Admin in your local PostgreSQL database.'
Write-Host 'No users, inventory, customers, or invoices are deleted.'
Write-Host 'First create and verify a database backup using scripts/backup-local-postgres.ps1.'
$backupConfirmation = Read-Host "Type I HAVE A BACKUP to proceed"
if ($backupConfirmation -cne 'I HAVE A BACKUP') { throw 'Stopped. Backup confirmation required.' }

$email = Read-Host 'Existing System Administrator email'
if ([string]::IsNullOrWhiteSpace($email)) { throw 'Administrator email is required.' }
$passwordSecure = Read-Host 'New unique password (12 characters or more)' -AsSecureString
$confirmSecure = Read-Host 'Confirm new password' -AsSecureString
$ptr = [IntPtr]::Zero
$confirmPtr = [IntPtr]::Zero
try {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
  $confirmPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmSecure)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $confirm = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmPtr)
  if ($password -cne $confirm) { throw 'Passwords do not match. No account was changed.' }
  if ($password.Length -lt 12) { throw 'Password must be at least 12 characters.' }
  $payload = @{ email = $email; password = $password; confirmation = 'RESET MY LOCAL ADMIN PASSWORD' } | ConvertTo-Json -Compress
  $payload | node scripts/recover-local-admin.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Administrator password recovery failed. No successful change was confirmed.' }
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if ($confirmPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmPtr) }
  Remove-Variable password, confirm, payload -ErrorAction SilentlyContinue
}
