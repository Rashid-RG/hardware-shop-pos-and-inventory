# Verify with a trust key provisioned independently of the retained release.
function Invoke-ArsPublisherSnapshot([string]$Project,[string]$TrustKey,[scriptblock]$UseSnapshot) {
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
      try {
        $remaining=$inputStream.Length
        $buffer=New-Object byte[] 1048576
        while ($remaining -gt 0) {
          $read=$inputStream.Read($buffer,0,[int][Math]::Min($remaining,$buffer.Length))
          if ($read -eq 0) {throw 'Publisher evidence truncated.'}
          $outputStream.Write($buffer,0,$read)
          $remaining-=$read
        }
        if ($inputStream.ReadByte() -ne -1) {throw 'Publisher evidence grew.'}
      } finally {$outputStream.Dispose()}
    } finally {$inputStream.Dispose()}
  }
  $Project=[IO.Path]::GetFullPath($Project)
  Assert-PlainPublisherPath $Project
  $temp=[IO.Path]::GetTempPath().TrimEnd('\')
  Assert-PlainPublisherPath $temp
  $work=Join-Path $temp ('ars-publisher-'+[guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($work)
  try {
    $assets=[ordered]@{'.ars-release-manifest.json'=65536;'.ars-release-manifest.sig'=16384;'.ars-release.zip'=536870912}
    foreach ($name in $assets.Keys) {Copy-PublisherAsset (Join-Path $Project $name) (Join-Path $work $name) $assets[$name]}
    $key=Join-Path $work 'trust.pem'
    Copy-PublisherAsset $TrustKey $key 65536
    $manifest=Join-Path $work '.ars-release-manifest.json'
    $signature=Join-Path $work '.ars-release-manifest.sig'
    $archive=Join-Path $work '.ars-release.zip'
    $openssl=(Get-Command openssl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    & $openssl dgst -sha256 -verify $key -signature $signature $manifest | Out-Null
    if ($LASTEXITCODE -ne 0) {throw 'Publisher signature invalid.'}
    $record=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
    if ($record.product -cne 'ARS Distributor' -or $record.platform -cne 'windows' -or $record.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$' -or $record.sha256 -cnotmatch '^[a-f0-9]{64}$') {throw 'Publisher manifest mismatch.'}
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $record.sha256) {throw 'Publisher archive mismatch.'}
    $clean=Join-Path $work 'clean'
    Expand-ArsRelease $archive $clean
    $package=Get-Content -LiteralPath (Join-Path $clean 'package.json') -Raw|ConvertFrom-Json
    if ($package.version -cne $record.version) {throw 'Publisher version mismatch.'}
    & $UseSnapshot $clean $record $work
  } finally {Remove-Item -LiteralPath $work -Recurse -Force}
}

function Get-ArsPublisherSourceReview([string]$Project,[string]$TrustKey) {
  . (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
  $Project=[IO.Path]::GetFullPath($Project)
  Invoke-ArsPublisherSnapshot $Project $TrustKey {
    param($clean,$record,$work)
    $expected=Join-Path $clean 'scripts'
    $actual=Join-Path $Project 'scripts'
    Assert-PlainPublisherPath $actual
    $expectedDigest=Get-ArsRecoveryToolsFingerprint $expected
    $actualDigest=Get-ArsRecoveryToolsFingerprint $actual
    if ($expectedDigest -cne $actualDigest) {throw 'Publisher recovery scripts mismatch.'}
    $package=Join-Path $Project 'package.json'
    Assert-PlainPublisherPath $package
    if ((Get-FileHash -LiteralPath $package).Hash -cne (Get-FileHash -LiteralPath (Join-Path $clean 'package.json')).Hash) {throw 'Publisher package mismatch.'}
    foreach ($name in $assets.Keys) {
      Assert-PlainPublisherPath (Join-Path $Project $name)
      if ((Get-FileHash -LiteralPath (Join-Path $Project $name)).Hash -cne (Get-FileHash -LiteralPath (Join-Path $work $name)).Hash) {throw 'Publisher evidence changed.'}
    }
    Assert-PlainPublisherPath $TrustKey
    if ((Get-FileHash -LiteralPath $TrustKey).Hash -cne (Get-FileHash -LiteralPath $key).Hash -or (Get-ArsRecoveryToolsFingerprint $actual) -cne $actualDigest) {throw 'Publisher trust or scripts changed.'}
    [pscustomobject]@{version=$record.version;archiveDigest=$record.sha256;publisherRecoveryScriptsVerified=$true;executionAllowed=$false;startupAllowed=$false;activationAllowed=$false;rollbackAllowed=$false}
  }
}

function Invoke-ArsTrustedIncidentRestore([string]$Project,[string]$Runtime,[string]$TrustKey,[string]$Confirmation) {
  if ($Confirmation -cne 'RUN ISOLATED INCIDENT RESTORE') {throw 'Explicit isolated restore confirmation required.'}
  foreach ($path in @($Project,$Runtime,$TrustKey)) {
    if ($path -notmatch '^[A-Za-z]:[\\/]') {throw 'Absolute local recovery paths required.'}
  }
  $Runtime=[IO.Path]::GetFullPath($Runtime)
  $node=(Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  Invoke-ArsPublisherSnapshot $Project $TrustKey {
    param($clean)
    Assert-PlainPublisherPath $Runtime
    $entry=Join-Path $clean 'scripts\writer-loss-restore-runner.mjs'
    if (-not [IO.File]::Exists($entry)) {throw 'This release lacks the isolated incident restore entry point.'}
    $processInfo=New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName=$node
    $processInfo.WorkingDirectory=$clean
    $processInfo.UseShellExecute=$false
    # Runtime root directories can have spaces or end in a path separator.
    $argument='"'+($Runtime -replace '(\\+)$','$1$1')+'"'
    $processInfo.Arguments='"'+$entry+'" '+$argument+' "'+$Confirmation+'"'
    foreach ($name in @('NODE_OPTIONS','NODE_PATH')) {$processInfo.EnvironmentVariables.Remove($name)}
    $child=[Diagnostics.Process]::Start($processInfo)
    try {
      $child.WaitForExit()
      if ($child.ExitCode -ne 0) {throw 'Trusted isolated restore did not complete.'}
    } finally {$child.Dispose()}
  }
}
