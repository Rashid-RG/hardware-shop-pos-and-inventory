# Provision a fixed recovery bootstrap from the approved Windows installation media.
. (Join-Path $PSScriptRoot 'windows-setup-destination.ps1')
function Install-ArsRecoveryTools([string]$Project,[string]$State) {
 $ErrorActionPreference='Stop'
 Assert-ArsPlainPath $State
 $source=Join-Path $Project 'scripts'
 $target=Join-Path $State 'update-tools'
 $names=@('expand-windows-release.ps1','windows-prepared-fingerprint.ps1',
  'windows-publisher-source.ps1','run-windows-trusted-incident-restore.ps1')
 $hashes=@{}
 foreach ($name in $names) {
  $path=Join-Path $source $name
  Assert-ArsPlainPath $path
  $item=Get-Item -LiteralPath $path -Force
  if ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 1048576) {throw 'Invalid recovery bootstrap file.'}
  $hashes[$name]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
 }

 $existing=@(Get-ChildItem -LiteralPath $State -Force | Where-Object Name -ieq 'update-tools')
 if ($existing.Count) {
  Assert-ArsPlainPath $target
  if (-not $existing[0].PSIsContainer) {throw 'Existing recovery tools path requires review.'}
  $installed=@(Get-ChildItem -LiteralPath $target -Force)
  if ($installed.Count -ne $names.Count) {throw 'Existing recovery tools require review.'}
  foreach ($name in $names) {
   $file=Join-Path $target $name
   Assert-ArsPlainPath $file
   if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne $hashes[$name]) {
    throw 'Existing recovery tools differ from this setup package.'
   }
  }
  return
 }

 $pending=Join-Path $State ('.recovery-tools-'+[guid]::NewGuid().ToString('N'))
 [void][IO.Directory]::CreateDirectory($pending)
 try {
  foreach ($name in $names) {
   $path=Join-Path $pending $name
   [IO.File]::Copy((Join-Path $source $name),$path,$false)
   if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $hashes[$name]) {
    throw 'Recovery bootstrap changed during copy.'
   }
  }
  [IO.Directory]::Move($pending,$target)
 } finally {
  if ([IO.Directory]::Exists($pending)) {
   foreach ($name in $names) {[IO.File]::Delete((Join-Path $pending $name))}
   [IO.Directory]::Delete($pending)
  }
 }
}
