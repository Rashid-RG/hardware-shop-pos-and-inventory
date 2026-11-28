# Safe backup for the configured local ARS PostgreSQL database and uploaded files.
# PowerShell: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-local-postgres.ps1
param(
  [string]$Container = 'hardware-pos-postgres',
  [string]$Database = '',
  [string]$DbUser = 'postgres',
  [string]$Destination = 'backups',
  [int]$Keep = 30,
  [switch]$OutputArchive,
  [switch]$PreserveExistingArchives,
  [string]$ExpectedSystemIdentifier,
  [string]$ExpectedDatabaseOid
)
$ErrorActionPreference = 'Stop'
$clusterBound=$PSBoundParameters.ContainsKey('ExpectedSystemIdentifier') -or $PSBoundParameters.ContainsKey('ExpectedDatabaseOid')
if ($clusterBound) {
  if (-not $PreserveExistingArchives -or -not $PSBoundParameters.ContainsKey('ExpectedSystemIdentifier') -or -not $PSBoundParameters.ContainsKey('ExpectedDatabaseOid')) {throw 'Complete protected backup identity required.'}
  . (Join-Path $PSScriptRoot 'windows-docker-cluster-identity.ps1')
  $null=ConvertFrom-ArsDockerClusterIdentity @($Database+'|'+$ExpectedSystemIdentifier+'|'+$ExpectedDatabaseOid) $Database
  $expectedContainer=if ($Database -ceq 'hardware_pos_ars') {'ars-windows-pilot-postgres'} else {'hardware-pos-postgres'}
  $expectedUser=if ($Database -ceq 'hardware_pos_ars') {'ars'} else {'postgres'}
  if ($Container -cne $expectedContainer -or $DbUser -cne $expectedUser) {throw 'Protected backup configuration mismatch.'}
}
if ($Keep -lt 7 -or $Keep -gt 3650) { throw 'Keep must be between 7 and 3650 successful backups.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'windows-runtime-paths.ps1')
$runtimeRoot = Get-ArsWindowsRuntimeRoot $projectRoot
# All Windows callers (manual, scheduled and encrypted backup) share this runtime lock,
# even when a caller selects a different archive destination.
$lockDirectory=Join-Path $runtimeRoot 'backups'
New-Item -ItemType Directory -Path $lockDirectory -Force | Out-Null
$lockItem=Get-Item -LiteralPath $lockDirectory -Force
if (-not $lockItem.PSIsContainer -or ($lockItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid local backup lock directory.' }
$lockPath=Join-Path $lockDirectory '.ars-local-backup.lock'
$localLock=$null
function Assert-NoBackupRecovery {
  if (@(Get-ChildItem -LiteralPath $lockDirectory -Force | Where-Object { $_.Name -ieq '.ars-drive-recovery.lock' }).Count -gt 0) { throw 'Backup recovery is active or interrupted.' }
}
function Get-LocalBackupBootEvidence {
  try {
    $os=Get-CimInstance -ClassName Win32_OperatingSystem
    $id=(Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
    if ([string]::IsNullOrWhiteSpace($id)) { return $null }
    $event=Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Kernel-General';Id=12} -MaxEvents 1 -ErrorAction Stop
    $sha=[Security.Cryptography.SHA256]::Create()
    try { $digest=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($id.ToLowerInvariant()))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    return [ordered]@{schema=1;hostDigest=$digest;bootUtc=$os.LastBootUpTime.ToUniversalTime().ToString('o');eventRecord=[string]$event.RecordId;eventUtc=$event.TimeCreated.ToUniversalTime().ToString('o')}
  } catch { return $null }
}
try {
  Assert-NoBackupRecovery
  try { $localLock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None) }
  catch [IO.IOException] { throw 'Local backup already running or interrupted. Review retained evidence before retrying.' }
  $lockBytes=[Text.Encoding]::UTF8.GetBytes(([ordered]@{schema=1;pid=$PID;startedAt=[DateTime]::UtcNow.ToString('o');bootId=$null;windowsBoot=(Get-LocalBackupBootEvidence)} | ConvertTo-Json -Compress))
  $localLock.Write($lockBytes,0,$lockBytes.Length)
  $localLock.Flush($true)
  Assert-NoBackupRecovery
  $envFile = Join-Path $runtimeRoot '.env.local'
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
if (-not [System.IO.Path]::IsPathRooted($Destination)) { $Destination = Join-Path $runtimeRoot $Destination }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$Destination = (Resolve-Path -LiteralPath $Destination).Path
# Windows PowerShell 5.1 can promote Docker stderr warnings to terminating errors.
# Suppress diagnostics for this probe only; still enforce the native exit code.
$previousPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  & docker info 2>$null | Out-Null
  $dockerInfoExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousPreference
}
if ($dockerInfoExitCode -ne 0) { throw 'Docker is unavailable.' }
$originalCluster=$null
if ($clusterBound) {
  $originalCluster=Confirm-ArsProtectedDockerCluster $Database $ExpectedSystemIdentifier $ExpectedDatabaseOid
  $Container=$originalCluster.containerId
}
function Assert-ProtectedBackupCluster {
  if ($clusterBound) {
    $current=Confirm-ArsProtectedDockerCluster $Database $ExpectedSystemIdentifier $ExpectedDatabaseOid
    if ($current.containerId -cne $originalCluster.containerId) {throw 'Protected Docker container changed.'}
  }
}
& docker inspect $Container *> $null
if ($LASTEXITCODE -ne 0) { throw 'Configured Docker container was not found.' }
$portMap = & docker port $Container '5432/tcp' 2>$null
if ($LASTEXITCODE -ne 0 -or -not $portMap) { throw 'Cannot verify PostgreSQL port mapping.' }
$configuredPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
if (-not ($portMap -match ":$configuredPort$")) {
  throw 'Docker mapped port does not match DATABASE_URL.'
}
$uploadsDir = Join-Path $runtimeRoot 'uploads'
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
  Assert-ProtectedBackupCluster
  if ($clusterBound) {
    & docker exec $Container pg_dump -w -h /var/run/postgresql -p 5432 -U $DbUser -d $Database -Fc -f $remoteFile
  } else {
    & docker exec $Container pg_dump -U $DbUser -d $Database -Fc -f $remoteFile
  }
  if ($LASTEXITCODE -ne 0) { throw 'Database pg_dump failed.' }
  Assert-ProtectedBackupCluster
  & docker exec $Container pg_restore --list $remoteFile *> $null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL archive validation failed.' }
  & docker cp "$($Container):$remoteFile" $tempFile
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy the database archive.' }
  $length = (Get-Item -LiteralPath $tempFile).Length
  if ($length -lt 1024) { throw 'Archive too small to trust.' }
  $hash = (Get-FileHash -LiteralPath $tempFile -Algorithm SHA256).Hash
  # sha256sum may return leading whitespace (including a CR) or multiple output lines.
  # Accept exactly one well-formed digest for the archive; compare case-insensitively.
  $remoteHash = & docker exec $Container sha256sum $remoteFile
  $hashExitCode = $LASTEXITCODE
  if ($hashExitCode -ne 0) { throw 'Could not calculate container archive SHA-256.' }
  $digestLines = @($remoteHash | Where-Object { $_ -match '^\s*[0-9a-fA-F]{64}\s+' })
  if ($digestLines.Count -ne 1) { throw 'Unexpected sha256sum output; cannot verify archive.' }
  $remoteDigest = [regex]::Match([string]$digestLines[0], '^\s*([0-9a-fA-F]{64})\s+').Groups[1].Value
  if (-not [string]::Equals($remoteDigest, $hash, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Database archive checksum mismatch. Container SHA-256: $remoteDigest; copied SHA-256: $hash"
  }
  if ($hasUploads) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($uploadsDir, $uploadTemp, [System.IO.Compression.CompressionLevel]::Optimal, $true)
    $uploadHash = (Get-FileHash -LiteralPath $uploadTemp -Algorithm SHA256).Hash
    Set-Content -LiteralPath $uploadChecksum -Value "$uploadHash  $name-uploads.zip" -Encoding ASCII
    Move-Item -LiteralPath $uploadTemp -Destination $uploadZip
  }
  Assert-ProtectedBackupCluster
  Set-Content -LiteralPath $checksumFile -Value "$hash  $name.dump" -Encoding ASCII
  # Publish the selectable dump last, after all companions are present.
  Move-Item -LiteralPath $tempFile -Destination $backupFile
  Write-Host "Verified PostgreSQL backup: $backupFile"
  Write-Host "Archive SHA-256: $hash"
  if (Test-Path $uploadZip) { Write-Host "Uploaded files archived: $uploadZip" }
  Write-Warning 'Archive metadata verification is not a restore drill. Copy files to an encrypted external drive.'
  # The cloud runner holds its lock from before archive creation until remote verification.
  # Defer all pruning when that lock exists (including interrupted cloud runs).
  $driveEvidence=@(Get-ChildItem -LiteralPath $lockDirectory -Force -ErrorAction Stop | Where-Object { $_.Name -ieq '.ars-drive-backup.lock' })
  if ($PreserveExistingArchives) {
    Write-Warning 'Backup retention deferred for protected maintenance. Existing archives retained.'
  } elseif ($driveEvidence.Count -gt 0) {
    Write-Warning 'Backup retention deferred while encrypted backup is running or interrupted.'
  } else {
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
if ($OutputArchive) { Write-Output "ARS_ARCHIVE=$backupFile" }

} finally {
  if ($null -ne $localLock) {
    $localLock.Dispose()
    # Never delete a lock we did not acquire. Abrupt termination retains evidence.
    Remove-Item -LiteralPath $lockPath -ErrorAction Stop
  }
}
