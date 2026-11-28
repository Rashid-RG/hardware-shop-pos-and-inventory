$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('ars-fingerprint-test-'+[guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $root | Out-Null
  Set-Content -LiteralPath (Join-Path $root 'server.cjs') -Value 'original'
  Get-ArsPreparedFingerprint $root | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $root '.ars-prepared-fingerprint.json')
  $null=Assert-ArsPreparedFingerprint $root
  Set-Content -LiteralPath (Join-Path $root 'server.cjs') -Value 'modified'
  $rejected=$false
  try { $null=Assert-ArsPreparedFingerprint $root } catch { $rejected=$true }
  if (-not $rejected) { throw 'Modified source accepted.' }
  Set-Content -LiteralPath (Join-Path $root 'server.cjs') -Value 'original'
  Set-Content -LiteralPath (Join-Path $root 'extra.txt') -Value 'extra'
  $rejected=$false
  try { $null=Assert-ArsPreparedFingerprint $root } catch { $rejected=$true }
  if (-not $rejected) { throw 'Added file accepted.' }
  Remove-Item -LiteralPath (Join-Path $root 'extra.txt')
  $null=Assert-ArsPreparedFingerprint $root
  Remove-Item -LiteralPath (Join-Path $root 'server.cjs')
  $rejected=$false
  try { $null=Assert-ArsPreparedFingerprint $root } catch { $rejected=$true }
  if (-not $rejected) { throw 'Missing file accepted.' }
  $scripts=Join-Path $root 'scripts'
  [void][IO.Directory]::CreateDirectory($scripts)
  $helper=Join-Path $scripts 'helper.ps1'
  [IO.File]::WriteAllText($helper,'original')
  $before=Get-ArsRecoveryToolsFingerprint $scripts
  [IO.File]::WriteAllText($helper,'modified')
  if ((Get-ArsRecoveryToolsFingerprint $scripts) -ceq $before) {throw 'Recovery modification undetected.'}
  [IO.File]::WriteAllText($helper,'original')
  if ((Get-ArsRecoveryToolsFingerprint $scripts) -cne $before) {throw 'Recovery fingerprint unstable.'}
  $writer=[IO.File]::Open($helper,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
  try {
    $rejected=$false
    try {$null=Get-ArsRecoveryToolsFingerprint $scripts} catch {$rejected=$true}
    if (-not $rejected) {throw 'Busy recovery file accepted.'}
  } finally {$writer.Dispose()}
  . (Join-Path $PSScriptRoot 'windows-publisher-source.ps1')
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $source=Join-Path $root 'publisher-source'
  $sourceScripts=Join-Path $source 'scripts'
  [void][IO.Directory]::CreateDirectory($sourceScripts)
  [IO.File]::WriteAllText((Join-Path $sourceScripts 'recover.ps1'),'original')
  [IO.File]::WriteAllText((Join-Path $source 'package.json'),'{"version":"1.2.3"}')
  $archive=Join-Path $root 'release.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($source,$archive)
  $private=Join-Path $root 'private.pem'
  $public=Join-Path $root 'public.pem'
  $openssl=(Get-Command openssl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  & $openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out $private
  if ($LASTEXITCODE -ne 0) {throw 'Test signing key generation failed.'}
  & $openssl pkey -in $private -pubout -out $public
  if ($LASTEXITCODE -ne 0) {throw 'Test trust key generation failed.'}
  $manifest=Join-Path $source '.ars-release-manifest.json'
  $signature=Join-Path $source '.ars-release-manifest.sig'
  [IO.File]::WriteAllText($manifest,(@{product='ARS Distributor';platform='windows';version='1.2.3';sha256=(Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant()}|ConvertTo-Json -Compress))
  & $openssl dgst -sha256 -sign $private -out $signature $manifest
  if ($LASTEXITCODE -ne 0) {throw 'Test signing failed.'}
  Copy-Item -LiteralPath $archive -Destination (Join-Path $source '.ars-release.zip')
  $review=Get-ArsPublisherSourceReview $source $public
  if (-not $review.publisherRecoveryScriptsVerified -or $review.executionAllowed) {throw 'Publisher source review failed.'}
  [IO.File]::WriteAllText((Join-Path $sourceScripts 'recover.ps1'),'modified')
  $rejected=$false
  try {$null=Get-ArsPublisherSourceReview $source $public} catch {$rejected=$true}
  if (-not $rejected) {throw 'Modified publisher recovery script accepted.'}
  [IO.File]::WriteAllText((Join-Path $sourceScripts 'recover.ps1'),'original')
  [IO.File]::WriteAllText($signature,'invalid')
  $rejected=$false
  try {$null=Get-ArsPublisherSourceReview $source $public} catch {$rejected=$true}
  if (-not $rejected) {throw 'Invalid publisher signature accepted.'}
  [IO.File]::WriteAllText((Join-Path $scripts 'helper.pyc'),'unexpected')
  $rejected=$false
  try {$null=Get-ArsRecoveryToolsFingerprint $scripts} catch {$rejected=$true}
  if (-not $rejected) {throw 'Standalone bytecode accepted.'}
} finally { if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force} }
