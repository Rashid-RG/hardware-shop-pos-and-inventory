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
} finally { if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force} }
