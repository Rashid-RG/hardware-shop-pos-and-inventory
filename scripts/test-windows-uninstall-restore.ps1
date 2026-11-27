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
