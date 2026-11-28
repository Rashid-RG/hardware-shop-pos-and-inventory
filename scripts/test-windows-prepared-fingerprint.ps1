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
  [IO.File]::WriteAllText((Join-Path $scripts 'helper.pyc'),'unexpected')
  $rejected=$false
  try {$null=Get-ArsRecoveryToolsFingerprint $scripts} catch {$rejected=$true}
  if (-not $rejected) {throw 'Standalone bytecode accepted.'}
} finally { if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force} }
