# Read-only publisher authentication. The verifier and trust key must be
# independently trusted. No recovery execution or startup is authorized.
function Get-ArsPublisherSourceReview([string]$Project,[string]$TrustKey) {
  $ErrorActionPreference='Stop'
  . (Join-Path $PSScriptRoot 'expand-windows-release.ps1')
  function Assert-PlainPublisherPath([string]$Path) {
    $cursor=[IO.Path]::GetFullPath($Path)
    while ($cursor) {
      $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Linked publisher evidence.'}
      $cursor=Split-Path -Parent $cursor
    }
  }
  function Copy-PublisherAsset([string]$From,[string]$To,[long]$Limit) {
    Assert-PlainPublisherPath $From
    $inputStream=[IO.File]::Open($From,'Open','Read','Read')
    try {
      if ($inputStream.Length -lt 1 -or $inputStream.Length -gt $Limit) {throw 'Invalid publisher asset size.'}
      $outputStream=[IO.File]::Open($To,'CreateNew','Write','None')
      try {$inputStream.CopyTo($outputStream)} finally {$outputStream.Dispose()}
    } finally {$inputStream.Dispose()}
  }
  $Project=[IO.Path]::GetFullPath($Project)
  Assert-PlainPublisherPath $Project
  $work=Join-Path ([IO.Path]::GetTempPath()) ('ars-publisher-'+[guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($work)
  try {
    $assets=[ordered]@{'.ars-release-manifest.json'=65536;'.ars-release-manifest.sig'=16384;'.ars-release.zip'=536870912}
    foreach ($name in $assets.Keys) {Copy-PublisherAsset (Join-Path $Project $name) (Join-Path $work $name) $assets[$name]}
    $key=Join-Path $work 'trust.pem'
    Copy-PublisherAsset $TrustKey $key 65536
    $manifest=Join-Path $work '.ars-release-manifest.json'
    $signature=Join-Path $work '.ars-release-manifest.sig'
    $archive=Join-Path $work '.ars-release.zip'
    $openssl=(Get-Command openssl.exe -CommandType Application -ErrorAction Stop).Source
    & $openssl dgst -sha256 -verify $key -signature $signature $manifest | Out-Null
    if ($LASTEXITCODE -ne 0) {throw 'Publisher signature invalid.'}
    $record=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
    if ($record.product -cne 'ARS Distributor' -or $record.platform -cne 'windows' -or $record.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$' -or $record.sha256 -cnotmatch '^[a-f0-9]{64}$') {throw 'Publisher manifest mismatch.'}
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $record.sha256) {throw 'Publisher archive mismatch.'}
    $clean=Join-Path $work 'clean'
    Expand-ArsRelease $archive $clean
    $expected=Join-Path $clean 'scripts'
    $actual=Join-Path $Project 'scripts'
    Assert-PlainPublisherPath $actual
    $expectedDigest=Get-ArsRecoveryToolsFingerprint $expected
    $actualDigest=Get-ArsRecoveryToolsFingerprint $actual
    if ($expectedDigest -cne $actualDigest) {throw 'Publisher recovery scripts mismatch.'}
    foreach ($name in @('package.json')) {
      $file=Join-Path $Project $name
      Assert-PlainPublisherPath $file
      if ((Get-FileHash -LiteralPath $file).Hash -cne (Get-FileHash -LiteralPath (Join-Path $clean $name)).Hash) {throw 'Publisher package mismatch.'}
    }
    $package=Get-Content -LiteralPath (Join-Path $clean 'package.json') -Raw|ConvertFrom-Json
    if ($package.version -cne $record.version) {throw 'Publisher version mismatch.'}
    foreach ($name in $assets.Keys) {
      if ((Get-FileHash -LiteralPath (Join-Path $Project $name)).Hash -cne (Get-FileHash -LiteralPath (Join-Path $work $name)).Hash) {throw 'Publisher evidence changed.'}
    }
    if ((Get-FileHash -LiteralPath $TrustKey).Hash -cne (Get-FileHash -LiteralPath $key).Hash -or (Get-ArsRecoveryToolsFingerprint $actual) -cne $actualDigest) {throw 'Publisher trust or scripts changed.'}
    [pscustomobject]@{version=$record.version;archiveDigest=$record.sha256;publisherRecoveryScriptsVerified=$true;executionAllowed=$false;startupAllowed=$false;activationAllowed=$false;rollbackAllowed=$false}
  } finally {Remove-Item -LiteralPath $work -Recurse -Force}
}
