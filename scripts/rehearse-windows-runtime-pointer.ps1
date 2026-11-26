# Disposable Windows pointer replacement rehearsal. No installed runtime access.
param()
$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('ars-pointer-rehearsal-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$pointer=Join-Path $root 'active.json'
$previous=Join-Path $root 'previous.json'
$utf8=New-Object Text.UTF8Encoding($false)
function Write-New([string]$Path,[string]$Value) {
  $bytes=$utf8.GetBytes($Value)
  $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
function Read-Pointer {
  $item=Get-Item -LiteralPath $pointer -Force
  if ($item.PSIsContainer -or $item.Length -gt 4096 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid rehearsal pointer.' }
  [IO.File]::ReadAllText($pointer)
}
function Replace-Pointer([string]$Expected,[string]$Next,[string]$Retained) {
  if ((Read-Pointer) -cne $Expected) { throw 'Stale rehearsal pointer.' }
  $pending=Join-Path $root ('pending-'+[guid]::NewGuid().ToString('N')+'.json')
  Write-New $pending $Next
  if ((Read-Pointer) -cne $Expected) { throw 'Pointer changed.' }
  if (Test-Path -LiteralPath $Retained) { throw 'Retained pointer already exists.' }
  [IO.File]::Replace($pending,$pointer,$Retained)
  if ((Read-Pointer) -cne $Next -or [IO.File]::ReadAllText($Retained) -cne $Expected) { throw 'Replacement verification failed.' }
}
try {
  $a='{"schema":1,"version":"previous","runtime":"fixture-runtime"}'
  $b='{"schema":1,"version":"candidate","runtime":"fixture-runtime"}'
  $runtime=Join-Path $root 'fixture-runtime'
  [void][IO.Directory]::CreateDirectory($runtime)
  $data=Join-Path $runtime 'sample.txt'
  Write-New $data 'disposable business data'
  $digest=(Get-FileHash -LiteralPath $data -Algorithm SHA256).Hash
  Write-New $pointer $a
  Replace-Pointer $a $b $previous
  $staleRejected=$false
  try { Replace-Pointer $a $b (Join-Path $root 'unexpected.json') } catch { $staleRejected=$true }
  if (-not $staleRejected -or (Read-Pointer) -cne $b) { throw 'Stale pointer rejection failed.' }
  Replace-Pointer $b $a (Join-Path $root 'failed-candidate.json')
  if ((Get-FileHash -LiteralPath $data -Algorithm SHA256).Hash -cne $digest) { throw 'Fixture runtime changed.' }
  [ordered]@{schema=1;candidateSwitchRehearsed=$true;rollbackRehearsed=$true;stalePointerRejected=$true;runtimePreserved=$true;activationAllowed=$false;startupAllowed=$false} | ConvertTo-Json
} finally {
  # Only files created in this unique temporary fixture are removed.
  foreach ($name in @('active.json','previous.json','failed-candidate.json','unexpected.json','fixture-runtime\sample.txt')) {
    $file=Join-Path $root $name
    if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) }
  }
  foreach ($file in @(Get-ChildItem -LiteralPath $root -Filter 'pending-*.json' -File)) { [IO.File]::Delete($file.FullName) }
  if ([IO.Directory]::Exists((Join-Path $root 'fixture-runtime'))) { [IO.Directory]::Delete((Join-Path $root 'fixture-runtime')) }
  [IO.Directory]::Delete($root)
}
