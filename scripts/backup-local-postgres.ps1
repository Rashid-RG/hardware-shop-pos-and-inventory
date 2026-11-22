# Backup the local Docker PostgreSQL database without touching sales or inventory.
# Run from Windows PowerShell: powershell -ExecutionPolicy Bypass -File scripts/backup-local-postgres.ps1
param(
  [string]$Container = 'hardware-pos-postgres',
  [string]$Database = 'hardware_pos',
  [string]$DbUser = 'postgres',
  [string]$Destination = 'backups'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
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
