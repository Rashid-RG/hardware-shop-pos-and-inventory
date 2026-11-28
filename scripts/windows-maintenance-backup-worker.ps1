# Internal worker for the native maintenance supervisor.
# Invoked only by a trusted coordinator under the protected database session.
# The result is observational evidence, not authorization for activation/removal.
param(
 [Parameter(Mandatory=$true)][string]$Destination,
 [Parameter(Mandatory=$true)][string]$ResultName,
 [ValidateSet('hardware_pos','hardware_pos_ars')][string]$Database='hardware_pos',
 [string]$ExpectedSystemIdentifier,
 [string]$ExpectedDatabaseOid
)
$ErrorActionPreference='Stop'
$clusterBound=$PSBoundParameters.ContainsKey('ExpectedSystemIdentifier') -or $PSBoundParameters.ContainsKey('ExpectedDatabaseOid')
$clusterParameters=@{}
if ($clusterBound) {
 if (-not $PSBoundParameters.ContainsKey('ExpectedSystemIdentifier') -or -not $PSBoundParameters.ContainsKey('ExpectedDatabaseOid')) {throw 'Complete protected worker identity required.'}
 . (Join-Path $PSScriptRoot 'windows-docker-cluster-identity.ps1')
 $null=ConvertFrom-ArsDockerClusterIdentity @($Database+'|'+$ExpectedSystemIdentifier+'|'+$ExpectedDatabaseOid) $Database
 $clusterParameters=@{ExpectedSystemIdentifier=$ExpectedSystemIdentifier;ExpectedDatabaseOid=$ExpectedDatabaseOid}
}
if ($ResultName -cnotmatch '^maintenance-result-[a-f0-9]{32}\.json$') {throw 'Invalid result name.'}
if (-not [IO.Path]::IsPathRooted($Destination)) {throw 'Absolute recovery destination required.'}
$folder=Get-Item -LiteralPath $Destination -Force
if (-not $folder.PSIsContainer -or ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Invalid recovery destination.'}
$destinationPath=$folder.FullName
$resultPath=Join-Path $destinationPath $ResultName
if (Test-Path -LiteralPath $resultPath) {throw 'Result already exists.'}
# Fixed allowlist: no caller-selected container or database user.
$container=if ($Database -ceq 'hardware_pos_ars') {'ars-windows-pilot-postgres'} else {'hardware-pos-postgres'}
$dbUser=if ($Database -ceq 'hardware_pos_ars') {'ars'} else {'postgres'}
if ($Database -cnotin @('hardware_pos','hardware_pos_ars')) {throw 'Unsupported managed database.'}
$archivePattern='^ars-'+[regex]::Escape($Database)+'-[A-Za-z0-9_-]+\.dump$'
$records=@(& (Join-Path $PSScriptRoot 'backup-local-postgres.ps1') -Destination $destinationPath -Database $Database -Container $container -DbUser $dbUser -OutputArchive -PreserveExistingArchives @clusterParameters)
$archives=@($records | Where-Object {$_ -is [string] -and $_.StartsWith('ARS_ARCHIVE=')})
if ($archives.Count -ne 1) {throw 'Unique backup archive result required.'}
$archive=Get-Item -LiteralPath $archives[0].Substring(12) -Force
if ($archive.PSIsContainer -or ($archive.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $archive.DirectoryName -ine $destinationPath -or $archive.Name -cnotmatch $archivePattern -or $archive.Length -lt 1024) {throw 'Invalid backup archive result.'}
$record=[ordered]@{schema=1;kind='windows-maintenance-worker-result';archive=$archive.Name;sha256=(Get-FileHash -LiteralPath $archive.FullName -Algorithm SHA256).Hash.ToLowerInvariant();applicationRemovalAllowed=$false;databaseDeletionAllowed=$false;activationAllowed=$false;continuousExclusionVerified=$false}
$bytes=[Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Compress))
$stream=[IO.File]::Open($resultPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {
 $stream.Write($bytes,0,$bytes.Length)
 $stream.Flush($true)
} finally {$stream.Dispose()}
