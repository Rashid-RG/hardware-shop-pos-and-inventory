# Restore an ARS PostgreSQL custom-format archive into a NEW isolated database.
# This deliberately never overwrites the active operational database.
param(
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [string]$Container = 'hardware-pos-postgres',
  [string]$DbUser = 'postgres',
  [string]$TargetDatabase = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env.local'
if (-not (Test-Path $envPath)) { throw 'Missing .env.local; cannot identify protected active database.' }
$dbLine = Get-Content $envPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $dbLine) { throw 'DATABASE_URL is not configured.' }
$dbUrl = (($dbLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'"))
try { $url = [System.Uri]$dbUrl } catch { throw 'Invalid DATABASE_URL.' }
if ($url.Host -notin @('localhost','127.0.0.1','::1','[::1]')) { throw 'This recovery tool is only for local Docker PostgreSQL.' }
$activeDb = [System.Uri]::UnescapeDataString($url.AbsolutePath.Trim('/'))
if ($activeDb -notmatch '^[a-zA-Z][a-zA-Z0-9_]*$') { throw 'Unsafe active database name.' }
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) { throw 'Backup archive not found.' }
$file = Get-Item -LiteralPath $BackupFile
if ($file.Extension -ne '.dump' -or $file.Length -lt 1024) { throw 'A valid .dump PostgreSQL archive is required.' }
$BackupFile = $file.FullName
$checksumFile = "$BackupFile.sha256"
if (-not (Test-Path -LiteralPath $checksumFile)) { throw 'Missing SHA-256 verification file. Refusing an unverified restore.' }
$expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split '\s+')[0]
if ($expected -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid SHA-256 checksum file.' }
$actual = (Get-FileHash -LiteralPath $BackupFile -Algorithm SHA256).Hash
if ($expected.ToUpperInvariant() -cne $actual.ToUpperInvariant()) { throw 'Checksum mismatch. The archive was damaged or altered.' }
if (-not $TargetDatabase) { $TargetDatabase = 'ars_restore_test_' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd_HHmmss') }
if ($TargetDatabase -notmatch '^ars_restore_test_[a-zA-Z0-9_]+$' -or $TargetDatabase.Length -gt 63) {
  throw 'Target must use the isolated ars_restore_test_* name prefix.'
}
if ($TargetDatabase -eq $activeDb) { throw 'Never restore over the active ARS database.' }
if ($TargetDatabase -eq 'postgres' -or $TargetDatabase -eq 'template1' -or $TargetDatabase -eq 'template0') { throw 'Cannot restore into a PostgreSQL system database.' }
$confirm = Read-Host "Restore into a NEW database '$TargetDatabase' (active database '$activeDb' will not be touched)? Type RESTORE TEST"
if ($confirm -cne 'RESTORE TEST') { throw 'Restore cancelled.' }

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker unavailable.' }
docker inspect $Container *> $null
if ($LASTEXITCODE -ne 0) { throw 'Database container not found.' }
# Guard against accidentally pointing Docker exec at a different database
# container than the DATABASE_URL on the local machine.
$portMap = docker port $Container '5432/tcp' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect database container port.' }
if ($url.Port -gt 0 -and $portMap -notmatch ":$($url.Port)(\s|$)") { throw 'Container port does not match the configured database URL.' }

$remote = "/tmp/ars-restore-" + [guid]::NewGuid().ToString('N') + '.dump'
$created = $false
try {
  $exists = docker exec $Container psql -U $DbUser -d postgres -tA -c "SELECT 1 FROM pg_database WHERE datname = '$TargetDatabase';"
  if ($LASTEXITCODE -ne 0) { throw 'Could not check target database.' }
  if (($exists | Out-String).Trim() -eq '1') { throw 'Target database already exists. Refusing to overwrite.' }
  docker cp $BackupFile "${Container}:${remote}"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to copy archive into Docker.' }
  docker exec $Container pg_restore --list $remote *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Archive failed PostgreSQL integrity validation.' }
  docker exec $Container createdb -U $DbUser $TargetDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Creating isolated restore database failed.' }
  $created = $true
  docker exec $Container pg_restore -U $DbUser --no-owner --no-acl --exit-on-error -d $TargetDatabase $remote
  if ($LASTEXITCODE -ne 0) { throw 'Restore failed. Partial TEST database left untouched for investigation.' }
  $tables = docker exec $Container psql -U $DbUser -d $TargetDatabase -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
  if ($LASTEXITCODE -ne 0 -or [int](($tables | Out-String).Trim()) -lt 1) { throw 'Restore finished but no public tables were found.' }
  Write-Host "Verified isolated restore: $TargetDatabase" -ForegroundColor Green
  Write-Host "Public tables verified: $(($tables | Out-String).Trim())"
  Write-Host "Active business database remains: $activeDb"
  Write-Warning 'This is a test restore. To recover a damaged business database, obtain specialist approval and prepare a separate documented cutover. Do not change DATABASE_URL automatically.'
} finally {
  docker exec $Container rm -f $remote *> $null
  if ($created) { Write-Host "Test database retained for independent verification: $TargetDatabase" }
}
