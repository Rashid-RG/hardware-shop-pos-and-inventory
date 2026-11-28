$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-install-recovery-tools.ps1')
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('ars-install-recovery-'+[guid]::NewGuid().ToString('N'))
$state=Join-Path $fixture 'state'
$project=Split-Path -Parent $PSScriptRoot
try {
 [void][IO.Directory]::CreateDirectory($state)
 Install-ArsRecoveryTools $project $state
 Install-ArsRecoveryTools $project $state
 $entry=Join-Path $state 'update-tools\run-windows-trusted-incident-restore.ps1'
 $record=(Get-FileHash -LiteralPath $entry).Hash
 if ($record -cne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'run-windows-trusted-incident-restore.ps1')).Hash) {throw 'Recovery entry not installed.'}
 [IO.File]::AppendAllText($entry,"# existing file")
 $changed=(Get-FileHash -LiteralPath $entry).Hash
 $blocked=$false
 try {Install-ArsRecoveryTools $project $state} catch {$blocked=$true}
 if (-not $blocked -or (Get-FileHash -LiteralPath $entry).Hash -cne $changed) {throw 'Existing recovery tools were overwritten.'}
 if ([IO.File]::Exists((Join-Path $state 'release-signing-public.pem'))) {throw 'Setup must not provision release trust from its own package.'}
} finally {
 if ([IO.Directory]::Exists($fixture)) {Remove-Item -LiteralPath $fixture -Recurse -Force}
}
