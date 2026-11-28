# Inspect signed release inputs only. No extraction, installation or database access.
param([switch]$Stage)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'expand-windows-release.ps1')
Add-Type -AssemblyName System.Windows.Forms
function Select-ReleaseFile([string]$Title,[string]$Filter) {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  try {
    $dialog.Title = $Title
    $dialog.Filter = $Filter
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog() -ne 'OK') { return $null }
    return $dialog.FileName
  } finally { $dialog.Dispose() }
}
function Get-SignedFeedRelease([string]$Node,[string[]]$Arguments,[string]$Caption) {
  $form=New-Object System.Windows.Forms.Form
  $form.Text='RS Nextward Update Center'
  $form.Width=470
  $form.Height=115
  $form.StartPosition='CenterScreen'
  $form.ControlBox=$false
  $label=New-Object System.Windows.Forms.Label
  $label.Text=$Caption
  $label.Dock='Top'
  $bar=New-Object System.Windows.Forms.ProgressBar
  $bar.Style='Marquee'
  $bar.Dock='Bottom'
  $form.Controls.Add($label)
  $form.Controls.Add($bar)
  $job=$null
  try {
    $job=Start-Job -ScriptBlock {
      param($request)
      $exe=$request.Executable
      $argv=@($request.Arguments)
      $result=& $exe @argv
      if ($LASTEXITCODE -ne 0) {throw 'Signed update feed could not be verified.'}
      $result
    } -ArgumentList ([pscustomobject]@{Executable=$Node;Arguments=$Arguments})
    $form.Show()
    $clock=[Diagnostics.Stopwatch]::StartNew()
    while ($job.State -in @('NotStarted','Running') -and $clock.Elapsed.TotalSeconds -lt 340) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 80
    }
    if ($job.State -ne 'Completed') {throw 'Signed update check or download did not complete.'}
    $result=Receive-Job -Job $job -ErrorAction Stop
    return ($result | Out-String | ConvertFrom-Json)
  } finally {
    if ($job) {Remove-Job -Job $job -Force}
    $form.Dispose()
  }
}
$temp = $null
try {
  $root = Split-Path -Parent $PSScriptRoot
  $installed = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
  $trust = Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\release-signing-public.pem'
  if (-not (Test-Path -LiteralPath $trust -PathType Leaf)) { throw 'No trusted RS Nextward release signing key is configured. Contact support. Never trust a key supplied with an update.' }
  $openssl = Get-Command openssl.exe -ErrorAction SilentlyContinue
  if (-not $openssl) { throw 'OpenSSL is required to verify releases. Contact RS Nextward support.' }
  $state=Split-Path -Parent $trust
  $feedFile=Join-Path $state 'release-feed-url.txt'
  $useFeed=$false
  if ($Stage -and (Test-Path -LiteralPath $feedFile -PathType Leaf)) {
    $choice=[System.Windows.Forms.MessageBox]::Show('Check the configured signed update feed? Choose No to select local update files.','RS Nextward Update Center','YesNoCancel','Question')
    if ($choice -eq 'Cancel') {return}
    $useFeed=$choice -eq 'Yes'
  }
  if ($useFeed) {
    foreach ($path in @($feedFile,$trust)) {
      $item=Get-Item -LiteralPath $path -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Update trust configuration must be a local file.'}
    }
    if ((Get-Item -LiteralPath $feedFile).Length -gt 2048) {throw 'Invalid update feed configuration.'}
    $feed=(Get-Content -LiteralPath $feedFile -Raw).Trim()
    $node=(Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    $arguments=@((Join-Path $PSScriptRoot 'download-signed-update.mjs'),$feed,'windows',$installed,$trust)
    $release=Get-SignedFeedRelease $node $arguments 'Checking the signed update feed.'
    if ($release.available -ne $true) {
      [void][System.Windows.Forms.MessageBox]::Show('No newer signed update is available.','RS Nextward Update Center','OK','Information')
      return
    }
    if ([System.Windows.Forms.MessageBox]::Show("Download verified update $($release.version)?",'RS Nextward Update Center','YesNo','Question') -ne 'Yes') {return}
    $temp=Join-Path ([System.IO.Path]::GetTempPath()) ('ars-feed-'+[guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($temp)
    $bundle=Join-Path $temp 'bundle'
    $download=Get-SignedFeedRelease $node ($arguments+@($bundle)) 'Downloading and verifying the signed update.'
    if ($download.available -ne $true -or $download.version -cne $release.version) {throw 'The update feed changed. Check for updates again.'}
    foreach ($name in @('manifest.json','manifest.sig','release.zip')) {
      [IO.File]::Move((Join-Path $bundle $name),(Join-Path $temp $name))
    }
  } else {
    $manifest = Select-ReleaseFile 'Select signed Windows release manifest' 'JSON manifest (*.json)|*.json'
    if (-not $manifest) { return }
    $signature = Select-ReleaseFile 'Select manifest signature' 'Signature (*.sig)|*.sig'
    if (-not $signature) { return }
    $archive = Select-ReleaseFile 'Select Windows release archive' 'ZIP archive (*.zip)|*.zip'
    if (-not $archive) { return }
    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ('ars-inspect-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp | Out-Null
    foreach ($entry in @(@{source=$manifest;name='manifest.json';limit=65536},@{source=$signature;name='manifest.sig';limit=16384},@{source=$archive;name='release.zip';limit=536870912})) {
      if ((Get-Item -LiteralPath $entry.source).Length -gt $entry.limit) { throw 'Release input exceeds size limit.' }
      $dest = Join-Path $temp $entry.name
      Copy-Item -LiteralPath $entry.source -Destination $dest
      if ((Get-Item -LiteralPath $dest).Length -gt $entry.limit) { throw 'Copied release input exceeds size limit.' }
    }
  }
  $m = Join-Path $temp 'manifest.json'
  $sig = Join-Path $temp 'manifest.sig'
  & $openssl.Source dgst -sha256 -verify $trust -signature $sig $m
  if ($LASTEXITCODE -ne 0) { throw 'Release signature verification failed.' }
  $data = Get-Content -LiteralPath $m -Raw | ConvertFrom-Json
  if ($data.product -cne 'ARS Distributor' -or $data.platform -cne 'windows' -or $data.version -isnot [string] -or $data.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$' -or $data.sha256 -isnot [string] -or $data.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Manifest is not a valid ARS Distributor Windows release.' }
  $hash = (Get-FileHash -LiteralPath (Join-Path $temp 'release.zip') -Algorithm SHA256).Hash
  if ($hash -ine $data.sha256) { throw 'Release archive checksum mismatch.' }
  if ($Stage) {
    $answer = [System.Windows.Forms.MessageBox]::Show("Stage verified release $($data.version) without installing it?",'RS Nextward Update Center','YesNo','Question')
    if ($answer -ne 'Yes') { return }
    $staging = Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\staged-releases'
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    $target = Join-Path $staging $data.version
    if (Test-Path -LiteralPath $target) { throw 'This release is already staged.' }
    $source = Join-Path $temp 'source'
    Expand-ArsRelease (Join-Path $temp 'release.zip') $source
    foreach ($required in @('package.json','package-lock.json','server.ts','scripts/start-local.ps1')) {
      if (-not (Test-Path -LiteralPath (Join-Path $source $required) -PathType Leaf)) { throw 'Required release file missing.' }
    }
    $package = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
    if ($package.version -isnot [string] -or $package.version -cne $data.version) { throw 'Package version does not match the signed release manifest.' }
    Copy-Item -LiteralPath $m -Destination (Join-Path $source '.ars-release-manifest.json')
    Copy-Item -LiteralPath $sig -Destination (Join-Path $source '.ars-release-manifest.sig')
    Copy-Item -LiteralPath (Join-Path $temp 'release.zip') -Destination (Join-Path $source '.ars-release.zip')
    # Publish to a unique pending directory on the same volume before final rename.
    $pending = Join-Path $staging ('.pending-' + [guid]::NewGuid().ToString('N'))
    try {
      Copy-Item -LiteralPath $source -Destination $pending -Recurse
      [IO.Directory]::Move($pending,$target)
    } finally {
      if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Recurse -Force }
    }
    [void][System.Windows.Forms.MessageBox]::Show("Verified source staged at $target. No build, database connection or installation was performed.",'RS Nextward Update Center','OK','Information')
    return
  }
  $notes = if ($data.notes -is [string]) { $data.notes.Substring(0,[Math]::Min(1200,$data.notes.Length)) } else { 'No release notes supplied.' }
  $message = "Checkout package version: $installed`nVerified release: $($data.version)`nSignature and archive SHA-256 verified.`n`n$notes`n`nInspection only. Nothing was installed or authorized for installation."
  [void][System.Windows.Forms.MessageBox]::Show($message,'RS Nextward Update Center','OK','Information')
} catch {
  [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'RS Nextward Update Center','OK','Error')
  exit 1
} finally {
  if ($temp -and (Test-Path -LiteralPath $temp)) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
