# Backup the local Docker PostgreSQL database without touching sales or inventory.
# Run from Windows PowerShell: powershell -ExecutionPolicy Bypass -File scripts/backup-local-postgres.ps1
param(
  [string]$Container = 'hardware-pos-postgres',
  [string]$Database = '',
  [string]$DbUser = 'postgres',
  [string]$Destination = 'backups'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
# Always detect the actual configured local business database. Never assume
# hardware_pos when the owner has switched to hardware_pos_ars.
$envFile = Join-Path $projectRoot '.env.local'
if (-not (Test-Path $envFile)) { throw '.env.local not found; cannot verify the target database.' }
$line = Get-Content $envFile | Where-Object { $_ -match '^\\s*DATABASE_URL\\s*=' } | Select-Object -First 1
if (-not $line) { throw 'DATABASE_URL is missing; refusing to guess database.' }
$dbUrl = (($line -replace '^\\s*DATABASE_URL\\s*=\\s*', '').Trim().Trim('"').Trim("'"))
try { $dbUri = [System.Uri]$dbUrl } catch { throw 'DATABASE_URL is invalid.' }
if ($dbUri.Host -notin @('localhost','127.0.0.1','::1','[::1]')) { throw 'Only local Docker PostgreSQL databases can be backed up by this script.' }
$configuredDb = [System.Uri]::UnescapeDataString($dbUri.AbsolutePath.Trim('/'))
if (-not $configuredDb -or $configuredDb -notmatch '^[a-zA-Z][a-zA-Z0-9_]*
if (-not [System.IO.Path]::IsPathRooted($Destination)) {
  $Destination = Join-Path $projectRoot $Destination
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker is unavailable. No backup created.' }
docker inspect $Container *> $null
if ($LASTEXITCODE -ne 0) { throw "Container '$Container' not found. Verify the actual database host before backing up." }
$portMap = docker port $Container '5432/tcp' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify Docker database port mapping.' }
if ($dbUri.Port -gt 0 -and $portMap -notmatch ":$($dbUri.Port)(\\s|$)") {
  throw 'Docker container port differs from active DATABASE_URL. Refusing to back up the wrong database.'
}
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$baseName = "ars-$Database-$stamp"
$remoteFile = "/tmp/$baseName.dump"
$backupFile = Join-Path $Destination "$baseName.dump"
try {
  & docker exec $Container pg_dump -U $DbUser -d $Database -Fc -f $remoteFile
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed; no backup can be trusted.' }
  & docker exec $Container pg_restore --list $remoteFile *> $null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL archive validation failed.' }
  & docker cp "${Container}:${remoteFile}" $backupFile
  if ($LASTEXITCODE -ne 0) { throw 'Failed to copy database backup from container.' }
  $file = Get-Item $backupFile
  if ($file.Length -lt 1024) { throw 'Backup archive is unexpectedly small.' }
  $hash = (Get-FileHash -Path $backupFile -Algorithm SHA256).Hash
  $hashFile = "$backupFile.sha256"
  Set-Content -Path $hashFile -Value "$hash  $($file.Name)" -Encoding ASCII
  Write-Host "Backup saved: $backupFile"
  Write-Host "Size: $($file.Length) bytes"
  Write-Host "SHA256: $hash"
  Write-Warning 'Copy this file to a separate encrypted drive/cloud location. Restore it into a TEST database before relying on it.'
} catch {
  if (Test-Path $backupFile) { Remove-Item $backupFile -Force }
  throw
} finally {
  & docker exec $Container rm -f $remoteFile *> $null
}
) { throw 'Configured database name is missing or unsafe.' }
if (-not $Database) { $Database = $configuredDb }
if ($Database -cne $configuredDb) { throw "Refusing to back up '$Database' because the active configured database is '$configuredDb'." }

if (-not [System.IO.Path]::IsPathRooted($Destination)) {
  $Destination = Join-Path $projectRoot $Destination
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker is unavailable. No backup created.' }
docker inspect $Container *> $null
if ($LASTEXITCODE -ne 0) { throw "Container '$Container' not found. Verify the actual database host before backing up." }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$baseName = "hardware-pos-$stamp"
$remoteFile = "/tmp/$baseName.dump"
$backupFile = Join-Path $Destination "$baseName.dump"
try {
  & docker exec $Container pg_dump -U $DbUser -d $Database -Fc -f $remoteFile
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed; no backup can be trusted.' }
  & docker exec $Container pg_restore --list $remoteFile *> $null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL archive validation failed.' }
  & docker cp "${Container}:${remoteFile}" $backupFile
  if ($LASTEXITCODE -ne 0) { throw 'Failed to copy database backup from container.' }
  $file = Get-Item $backupFile
  if ($file.Length -lt 1024) { throw 'Backup archive is unexpectedly small.' }
  $hash = (Get-FileHash -Path $backupFile -Algorithm SHA256).Hash
  $hashFile = "$backupFile.sha256"
  Set-Content -Path $hashFile -Value "$hash  $($file.Name)" -Encoding ASCII
  Write-Host "Backup saved: $backupFile"
  Write-Host "Size: $($file.Length) bytes"
  Write-Host "SHA256: $hash"
  Write-Warning 'Copy this file to a separate encrypted drive/cloud location. Restore it into a TEST database before relying on it.'
} catch {
  if (Test-Path $backupFile) { Remove-Item $backupFile -Force }
  throw
} finally {
  & docker exec $Container rm -f $remoteFile *> $null
}
