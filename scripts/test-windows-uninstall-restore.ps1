$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-uninstall-restore.ps1')
$tables=[ordered]@{}
foreach ($name in @('products','customers','sales_transactions','sales_transaction_items','customer_credit_payments')) {$tables[$name]=[pscustomobject]@{rows=1;sha256=('a'*64)}}
$expected=[pscustomobject]$tables
$actual=($expected|ConvertTo-Json -Depth 5)|ConvertFrom-Json
Assert-ArsUninstallRestoredTables $expected $actual
$actual.customers.sha256='b'*64
$blocked=$false
try {Assert-ArsUninstallRestoredTables $expected $actual} catch {$blocked=$true}
if (-not $blocked) {throw 'Altered customer record accepted.'}
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('ars-uninstall-zip-'+[guid]::NewGuid().ToString('N')+'.zip')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
 $zip=[IO.Compression.ZipFile]::Open($fixture,[IO.Compression.ZipArchiveMode]::Create)
 try {$entry=$zip.CreateEntry('uploads/sample.txt');$stream=$entry.Open();try {$stream.WriteByte(65)} finally {$stream.Dispose()}} finally {$zip.Dispose()}
 if ((Get-ArsUninstallUploadCount $fixture) -ne 1) {throw 'Upload archive member missing.'}
 $zip=[IO.Compression.ZipFile]::Open($fixture,[IO.Compression.ZipArchiveMode]::Update)
 try {$null=$zip.CreateEntry('uploads/../unexpected.txt')} finally {$zip.Dispose()}
 $blocked=$false
 try {Get-ArsUninstallUploadCount $fixture|Out-Null} catch {$blocked=$true}
 if (-not $blocked) {throw 'Unsafe archive member accepted.'}
} finally {if ([IO.File]::Exists($fixture)) {[IO.File]::Delete($fixture)}}

. (Join-Path $PSScriptRoot 'windows-uninstall-final-review.ps1')
$id='a'*32
$archive='ars-hardware_pos-20261127-120000-123-'+$id+'-with-uploads.dump'
$evidence=[ordered]@{hold=('B'*64);proof=('C'*64);meta=('D'*64)}
$members=[ordered]@{}
foreach ($name in (@(Get-ArsUninstallArchiveMembers $archive)+@('uninstall-table-manifest.json'))) {$members[$name]='e'*64}
$flags=@('applicationRemovalAllowed','databaseDeletionAllowed','serviceRemovalAllowed','uninstalled','finalUninstallBackupVerified','continuousExclusionVerified')
$fixtureRecord=[ordered]@{schema=1;kind='windows-uninstall-restore-observation';uninstallId=$id;archiveSha256=$members[$archive];isolatedRestorePassed=$true;allPublicTableFingerprintsMatched=$true;uploadArchiveReadable=$true;restoredTableCount=5;uploadMemberCount=0;evidenceDigests=$evidence;archiveMemberDigests=$members}
foreach ($flag in $flags) {$fixtureRecord[$flag]=$false}
$json=$fixtureRecord|ConvertTo-Json -Depth 8
$observation=$json|ConvertFrom-Json
$plan=New-ArsFinalUninstallEvidenceReview $observation $id $archive $evidence $members
if ($plan.restoreObservationMatched -ne $true) {throw 'Valid observation rejected.'}
foreach ($flag in $flags) {
 if ($plan[$flag] -isnot [bool] -or $plan[$flag]) {throw 'Unsafe review authorization.'}
 $bad=$json|ConvertFrom-Json
 $bad.$flag=$true
 $blocked=$false
 try {New-ArsFinalUninstallEvidenceReview $bad $id $archive $evidence $members|Out-Null} catch {$blocked=$true}
 if (-not $blocked) {throw "Unexpected authorization accepted: $flag"}
}
foreach ($key in @('uninstallId','archiveSha256','isolatedRestorePassed','evidenceDigests','archiveMemberDigests')) {
 $bad=$json|ConvertFrom-Json
 $bad.PSObject.Properties.Remove($key)
 $blocked=$false
 try {New-ArsFinalUninstallEvidenceReview $bad $id $archive $evidence $members|Out-Null} catch {$blocked=$true}
 if (-not $blocked) {throw "Missing observation evidence accepted: $key"}
}
foreach ($key in @('proof','archive')) {
 $bad=$json|ConvertFrom-Json
 if ($key -eq 'proof') {$bad.evidenceDigests.proof='F'*64} else {$bad.archiveMemberDigests.$archive='f'*64}
 $blocked=$false
 try {New-ArsFinalUninstallEvidenceReview $bad $id $archive $evidence $members|Out-Null} catch {$blocked=$true}
 if (-not $blocked) {throw "Changed evidence accepted: $key"}
}


# Recovery metadata review for both supported Windows database names.
foreach ($database in @('hardware_pos','hardware_pos_ars')) {
 $candidate='ars-'+$database+'-20261127-120000-123-'+$id+'-with-uploads.dump'
 $candidateMembers=@(Get-ArsUninstallArchiveMembers $candidate)
 $base=$candidate.Substring(0,$candidate.Length-5)
 $expectedMembers=@($candidate,($candidate+'.sha256'),($base+'-uploads.zip'),($base+'-uploads.zip.sha256'))
 if ($candidateMembers.Count -ne 4 -or ($candidateMembers -join '|') -cne ($expectedMembers -join '|')) {throw 'Recovery archive companion mismatch.'}
 $candidateHashes=[ordered]@{}
 foreach ($member in ($candidateMembers+@('uninstall-table-manifest.json'))) {$candidateHashes[$member]='e'*64}
 $candidateObservation=$json|ConvertFrom-Json
 $candidateObservation.archiveSha256=$candidateHashes[$candidate]
 $candidateObservation.archiveMemberDigests=($candidateHashes|ConvertTo-Json|ConvertFrom-Json)
 $candidatePlan=New-ArsFinalUninstallEvidenceReview $candidateObservation $id $candidate $evidence $candidateHashes
 if ($candidatePlan.restoreObservationMatched -ne $true) {throw 'Supported recovery archive rejected.'}
 foreach ($flag in $flags) {if ($candidatePlan[$flag] -isnot [bool] -or $candidatePlan[$flag]) {throw 'Unexpected recovery authorization.'}}
}
foreach ($invalid in @(
 ('ars-hardware_pos_ci-20261127-120000-123-'+$id+'-with-uploads.dump'),
 ('ars-other-20261127-120000-123-'+$id+'-with-uploads.dump'),
 ('ars-hardware_pos_ars-20261127-120000-123-'+$id+'-database-only.dump'),
 ('ars-hardware_pos_ars-20261127-120000-123-invalid-with-uploads.dump')
)) {
 $blocked=$false
 try {Get-ArsUninstallArchiveMembers $invalid|Out-Null} catch {$blocked=$true}
 if (-not $blocked) {throw 'Unsupported recovery archive accepted.'}
}
Write-Host 'Legacy and fresh installer recovery archive compatibility checks passed.'


# Source database binding must distinguish the two full archive prefixes.
$legacyArchive='ars-hardware_pos-20261127-120000-123-'+$id+'-with-uploads.dump'
$pilotArchive='ars-hardware_pos_ars-20261127-120000-123-'+$id+'-with-uploads.dump'
Assert-ArsUninstallSourceDatabase 'hardware_pos' $legacyArchive
Assert-ArsUninstallSourceDatabase 'hardware_pos_ars' $pilotArchive
$invalidBindings=@(
 @{database='hardware_pos';archive=$pilotArchive;error='Recovery source database mismatch.'},
 @{database='hardware_pos_ars';archive=$legacyArchive;error='Recovery source database mismatch.'},
 @{database='';archive=$legacyArchive;error='Unsupported recovery source database.'},
 @{database=$null;archive=$legacyArchive;error='Unsupported recovery source database.'},
 @{database='hardware_pos_ci';archive=$legacyArchive;error='Unsupported recovery source database.'},
 @{database='HARDWARE_POS';archive=$legacyArchive;error='Unsupported recovery source database.'},
 @{database='hardware_pos_ars';archive=($pilotArchive.Replace('with-uploads','database-only'));error='Recovery source database mismatch.'},
 @{database='hardware_pos';archive='';error='Recovery source database mismatch.'}
)
foreach ($binding in $invalidBindings) {
 $blocked=$false
 try {Assert-ArsUninstallSourceDatabase $binding.database $binding.archive}
 catch {
  if ($_.Exception.Message -cne $binding.error) {throw}
  $blocked=$true
 }
 if (-not $blocked) {throw 'Invalid recovery source database binding accepted.'}
}
Write-Host 'Recovery source database identity checks passed.'


# Preparation must reject foreign installations before inspecting Docker or state.
. (Join-Path $PSScriptRoot 'windows-continuous-recovery-preparation.ps1')
$foreign=Join-Path ([IO.Path]::GetTempPath()) ('ars-foreign-'+[guid]::NewGuid().ToString('N'))
$blocked=$false
try {Initialize-ArsContinuousRecovery $foreign|Out-Null}
catch {
 if ($_.Exception.Message -cne 'Managed installation required.') {throw}
 $blocked=$true
}
if (-not $blocked) {throw 'Foreign recovery installation accepted.'}
if (Test-Path -LiteralPath $foreign) {throw 'Foreign recovery directory created.'}
# Invalid identifiers must be rejected before any directory creation.
$managedState=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
foreach ($invalidId in @('','..','../outside',('A'*32),('a'*31),('a'*33))) {
 $blocked=$false
 try {New-ArsPrivateUninstallRecoveryDirectory $managedState $invalidId|Out-Null}
 catch {
  if ($_.Exception.Message -cne 'Managed recovery identity required.') {throw}
  $blocked=$true
 }
 if (-not $blocked) {throw 'Invalid private recovery identity accepted.'}
}
# Exercise the preparation contract without creating real application state.
$source=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-continuous-recovery-preparation.ps1') -Raw
$checkIndex=$source.IndexOf("  Assert-ContinuousShutdown")
$createIndex=$source.IndexOf('  $folder=New-ArsPrivateUninstallRecoveryDirectory')
$uploadIndex=$source.IndexOf('  $uploads=Get-ArsPreparedFingerprint')
$lastCheck=$source.LastIndexOf("  Assert-ContinuousShutdown")
if ($checkIndex -lt 0 -or $createIndex -le $checkIndex -or $uploadIndex -le $createIndex -or $lastCheck -le $uploadIndex) {throw 'Recovery preparation guard order changed.'}
if (-not $source.Contains('$mutex.WaitOne(0)') -or -not $source.Contains('if ($owned) {$mutex.ReleaseMutex()}') -or -not $source.Contains('$mutex.Dispose()')) {throw 'Recovery preparation mutex contract changed.'}
if (-not $source.Contains('applicationRemovalAllowed=$false;databaseDeletionAllowed=$false;activationAllowed=$false;continuousExclusionVerified=$false')) {throw 'Recovery preparation authorization contract changed.'}
Write-Host 'Continuous recovery preparation guard and ordering checks passed.'


# Exercise opt-in rehearsal guards without stopping any application.
. (Join-Path $PSScriptRoot 'windows-continuous-recovery-rehearsal.ps1')
foreach ($confirmation in @('','STOP','stop pos for uninstall backup','STOP POS FOR UNINSTALL BACKUP ')) {
 $blocked=$false
 try {Invoke-ArsContinuousRecoveryRehearsal $foreign $confirmation|Out-Null}
 catch {
  if ($_.Exception.Message -cne 'Explicit shutdown approval required.') {throw}
  $blocked=$true
 }
 if (-not $blocked) {throw 'Unapproved shutdown accepted.'}
}
$blocked=$false
try {Invoke-ArsContinuousRecoveryRehearsal $foreign 'STOP POS FOR UNINSTALL BACKUP'|Out-Null}
catch {
 if ($_.Exception.Message -cne 'Managed installation required.') {throw}
 $blocked=$true
}
if (-not $blocked) {throw 'Foreign rehearsal accepted.'}
$source=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-continuous-recovery-rehearsal.ps1') -Raw
$approval=$source.IndexOf("Explicit shutdown approval required.")
$stop=$source.IndexOf("& (Join-Path "+'$PSScriptRoot'+" 'stop-local.ps1')")
$prepare=$source.IndexOf('$prepared=Initialize-ArsContinuousRecovery')
$firstCheck=$source.IndexOf(([string][char]10+' Assert-RecoveryPreparationUnchanged'))
$invoke=$source.IndexOf('$lines=@(& node $entry')
$lastCheck=$source.LastIndexOf(([string][char]10+' Assert-RecoveryPreparationUnchanged'))
$return=$source.IndexOf(' return $result')
if ($approval -lt 0 -or $stop -le $approval -or $prepare -le $stop -or $firstCheck -le $prepare -or $invoke -le $firstCheck -or $lastCheck -le $invoke -or $return -le $lastCheck) {throw 'Continuous rehearsal stage ordering changed.'}
foreach ($needle in @('$LASTEXITCODE -ne 0','$lines.Count -ne 1',"StartsWith('ARS_RECOVERY=')",'$result.uninstallId -cne $prepared.uninstallId','$result.$flag -isnot [bool]','$prepared.uploadsDigest','Get-ArsPreparedFingerprint')) {
 if (-not $source.Contains($needle)) {throw "Missing rehearsal guard: $needle"}
}
Write-Host 'Continuous recovery rehearsal early guards and stage ordering passed.'


# Read-only Docker identity parser regression: no Docker or live database access.
. (Join-Path $PSScriptRoot 'windows-docker-cluster-identity.ps1')
foreach ($database in @('hardware_pos','hardware_pos_ars')) {
 $identity=ConvertFrom-ArsDockerClusterIdentity @("$database|18446744073709551615|4294967295") $database
 if ($identity.database -cne $database -or $identity.systemIdentifier -cne '18446744073709551615' -or $identity.databaseOid -cne '4294967295') {throw 'Docker identity precision lost.'}
}
foreach ($invalid in @(
 'hardware_pos|18446744073709551616|1',
 'hardware_pos|1|4294967296',
 'hardware_pos|0|1',
 'hardware_pos|01|1',
 'hardware_pos|1|0',
 'hardware_pos|1|01',
 'hardware_pos|-1|1',
 'hardware_pos|1|1|extra',
 'hardware_pos_ars|1|1',
 'hardware_pos|1| 1',
 'hardware_pos|1'
)) {
 $blocked=$false
 try {ConvertFrom-ArsDockerClusterIdentity @($invalid) 'hardware_pos'|Out-Null} catch {$blocked=$true}
 if (-not $blocked) {throw 'Invalid Docker identity accepted.'}
}
foreach ($candidate in @(@{lines=@()},@{lines=@('hardware_pos|1|1','hardware_pos|1|1')},@{lines=@(123)})) {
 $blocked=$false
 try {ConvertFrom-ArsDockerClusterIdentity $candidate.lines 'hardware_pos'|Out-Null} catch {$blocked=$true}
 if (-not $blocked) {throw 'Non-unique or malformed Docker identity accepted.'}
}
$blocked=$false
try {Get-ArsDockerClusterIdentity 'hardware_pos_ci'|Out-Null} catch {
 if ($_.Exception.Message -cne 'Unsupported managed database.') {throw}
 $blocked=$true
}
if (-not $blocked) {throw 'Unsupported Docker source accepted.'}
Write-Host 'Docker cluster identity parser and early guard checks passed.'
