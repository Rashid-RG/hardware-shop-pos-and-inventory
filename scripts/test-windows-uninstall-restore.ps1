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
