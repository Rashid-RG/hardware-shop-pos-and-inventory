# Safe backup for the configured local ARS PostgreSQL database and uploaded files.
# PowerShell: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-local-postgres.ps1
param(
  [string]$Container = 'hardware-pos-postgres',
  [string]$Database = '',
  [string]$DbUser = 'postgres',
  [string]$Destination = 'backups',
  [int]$Keep = 30
)
$ErrorActionPreference = 'Stop'
if ($Keep -lt 7 -or $Keep -gt 3650) { throw 'Keep must be between 7 and 3650 successful backups.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Missing .env.local; refusing to guess the active database.' }
$line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $line) { throw 'DATABASE_URL is missing.' }
$dbUrl = (($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'"))
try { $uri = [System.Uri]$dbUrl } catch { throw 'Invalid DATABASE_URL.' }
if ($uri.Host -notin @('localhost', '127.0.0.1', '::1', '[::1]')) {
  throw 'This Windows backup command only supports local Docker PostgreSQL.'
}
$configuredDb = [System.Uri]::UnescapeDataString($uri.AbsolutePath.Trim('/'))
if ($configuredDb -notmatch '^[a-zA-Z][a-zA-Z0-9_]*$') { throw 'Configured database name is missing or unsafe.' }
if (-not $Database) { $Database = $configuredDb }
if ($Database -cne $configuredDb) { throw 'Requested database does not match DATABASE_URL. Refusing backup.' }
if (-not [System.IO.Path]::IsPathRooted($Destination)) { $Destination = Join-Path $projectRoot $Destination }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$Destination = (Resolve-Path -LiteralPath $Destination).Path
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker is unavailable.' }
& docker inspect $Container *> $null
if ($LASTEXITCODE -ne 0) { throw 'Configured Docker container was not found.' }
$portMap = & docker port $Container '5432/tcp' 2>$null
if ($LASTEXITCODE -ne 0 -or -not $portMap) { throw 'Cannot verify PostgreSQL port mapping.' }
$configuredPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
if (-not ($portMap -match ":$configuredPort$")) {
  throw 'Docker mapped port does not match DATABASE_URL.'
}
$uploadsDir = Join-Path $projectRoot 'uploads'
$hasUploads = Test-Path -LiteralPath $uploadsDir -PathType Container
$scope = if ($hasUploads) { 'with-uploads' } else { 'database-only' }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss-fff')
$name = "ars-$Database-$stamp-$([guid]::NewGuid().ToString('N'))-$scope"
$remoteFile = "/tmp/$name.dump"
$backupFile = Join-Path $Destination "$name.dump"
$tempFile = "$backupFile.partial"
$checksumFile = "$backupFile.sha256"
$uploadZip = Join-Path $Destination "$name-uploads.zip"
$uploadTemp = "$uploadZip.partial.zip"
$uploadChecksum = "$uploadZip.sha256"
try {
  & docker exec $Container pg_isready -U $DbUser -d $Database *> $null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL is not ready.' }
  & docker exec $Container pg_dump -U $DbUser -d $Database -Fc -f $remoteFile
  if ($LASTEXITCODE -ne 0) { throw 'Database pg_dump failed.' }
  & docker exec $Container pg_restore --list $remoteFile *> $null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL archive validation failed.' }
  & docker cp "$($Container):$remoteFile" $tempFile
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy the database archive.' }
  $length = (Get-Item -LiteralPath $tempFile).Length
  if ($length -lt 1024) { throw 'Archive too small to trust.' }
  $hash = (Get-FileHash -LiteralPath $tempFile -Algorithm SHA256).Hash
  $remoteHash = & docker exec $Container sha256sum $remoteFile
  if ($LASTEXITCODE -ne 0 -or (($remoteHash -split '\s+')[0] -ne $hash)) { throw 'Database archive copy failed checksum verification.' }
  if ($hasUploads) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($uploadsDir, $uploadTemp, [System.IO.Compression.CompressionLevel]::Optimal, $true)
    $uploadHash = (Get-FileHash -LiteralPath $uploadTemp -Algorithm SHA256).Hash
    Set-Content -LiteralPath $uploadChecksum -Value "$uploadHash  $name-uploads.zip" -Encoding ASCII
    Move-Item -LiteralPath $uploadTemp -Destination $uploadZip
  }
  Set-Content -LiteralPath $checksumFile -Value "$hash  $name.dump" -Encoding ASCII
  # Publish the selectable dump last, after all companions are present.
  Move-Item -LiteralPath $tempFile -Destination $backupFile
  Write-Host "Verified PostgreSQL backup: $backupFile"
  Write-Host "Archive SHA-256: $hash"
  if (Test-Path $uploadZip) { Write-Host "Uploaded files archived: $uploadZip" }
  Write-Warning 'Archive metadata verification is not a restore drill. Copy files to an encrypted external drive.'
  # Only completed backups have the companion SHA-256 file.
  $completed = @(Get-ChildItem -LiteralPath $Destination -Filter "ars-$Database-*.dump" -File |
    Where-Object { Test-Path -LiteralPath "$($_.FullName).sha256" } |
    Sort-Object Name -Descending)
  foreach ($old in ($completed | Select-Object -Skip $Keep)) {
    $base = $old.FullName.Substring(0, $old.FullName.Length - '.dump'.Length)
    foreach ($filePath in @($old.FullName, "$($old.FullName).sha256", "$base-uploads.zip", "$base-uploads.zip.sha256")) {
      if (Test-Path -LiteralPath $filePath) { Remove-Item -LiteralPath $filePath -Force }
    }
  }
} catch {
  $cleanup = @($tempFile, $uploadTemp)
  if (-not (Test-Path -LiteralPath $backupFile)) { $cleanup += @($checksumFile, $uploadZip, $uploadChecksum) }
  foreach ($temp in $cleanup) {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
  }
  throw
} finally {
  & docker exec $Container rm -f $remoteFile *> $null
}
