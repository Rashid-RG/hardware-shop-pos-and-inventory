$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-uninstall-shutdown.ps1')
. (Join-Path $PSScriptRoot 'windows-uninstall-cancellation.ps1')
# Exercise actual file transitions in disposable fixtures; no live POS or database.
foreach ($phase in @('archive','receipt','proof-removed','complete')) {
 $fixture=Join-Path ([IO.Path]::GetTempPath()) ('ars-cancel-rehearsal-'+[guid]::NewGuid().ToString('N'))
 try {
  $control=Join-Path $fixture 'control'
  $project=Join-Path $fixture 'app'
  [void][IO.Directory]::CreateDirectory($control)
  [void][IO.Directory]::CreateDirectory($project)
  $sample=Join-Path $fixture 'business.json'
  $archive=Join-Path $fixture 'fixture.dump'
  [IO.File]::WriteAllText($sample,'synthetic business data')
  [IO.File]::WriteAllText($archive,'synthetic archive')
  $instance=[pscustomobject]@{schema=1;project=$project;pid=123;startedUtc='123456'}
  $hold=New-ArsUninstallShutdownHold $project $instance 'STOP POS FOR UNINSTALL BACKUP'
  $proof=[ordered]@{}
  foreach ($key in $hold.Keys) {$proof[$key]=$hold[$key]}
  $proof.shutdownVerified=$true
  $marker=Join-Path $control 'maintenance.json'
  $proofPath=Join-Path $control 'maintenance-shutdown.json'
  [IO.File]::WriteAllText($marker,($hold|ConvertTo-Json))
  [IO.File]::WriteAllText($proofPath,($proof|ConvertTo-Json))
  $hashes=[ordered]@{};$bytes=[ordered]@{}
  foreach ($p in @($marker,$proofPath)) {$hashes[$p]=(Get-FileHash -LiteralPath $p).Hash;$bytes[$p]=[IO.File]::ReadAllBytes($p)}
  $check={
   foreach ($p in @($marker,$proofPath)) {if ((Get-FileHash -LiteralPath $p).Hash -cne $hashes[$p]) {throw 'Fixture evidence changed.'}}
  }
  $realWrite=(Get-Command Write-ArsCancellationBytes -CommandType Function).ScriptBlock
  function Write-ArsCancellationBytes([string]$path,[byte[]]$data) {
   & $realWrite $path $data
   if (($phase -eq 'archive' -and (Split-Path -Leaf $path) -eq 'maintenance.json') -or ($phase -eq 'receipt' -and (Split-Path -Leaf $path) -eq 'cancellation.json')) {throw 'simulated interruption'}
  }
  function Remove-Item {
   param([string]$LiteralPath,[switch]$Recurse,[switch]$Force)
   Microsoft.PowerShell.Management\Remove-Item -LiteralPath $LiteralPath -Recurse:$Recurse -Force:$Force -ErrorAction Stop
   if ($phase -eq 'proof-removed' -and (Split-Path -Leaf $LiteralPath) -eq 'maintenance-shutdown.json') {throw 'simulated interruption'}
  }
  $blocked=$false
  try {$result=Complete-ArsUninstallCancellation $control $project ([pscustomobject]$hold) ([pscustomobject]$proof) $hashes $bytes @('repair-interrupted.json') $check} catch {if ($_.Exception.Message -ne 'simulated interruption') {throw};$blocked=$true}
  if ($phase -eq 'complete') {
   if ($blocked -or (Test-Path -LiteralPath $marker) -or (Test-Path -LiteralPath $proofPath) -or $result.applicationStarted -or $result.applicationRemovalAllowed) {throw 'Cancellation completion mismatch.'}
  } elseif (-not $blocked -or (Get-FileHash -LiteralPath $marker).Hash -cne $hashes[$marker]) {throw 'Interrupted cancellation lost startup block.'}
  $history=Join-Path $control ('uninstall-cancelled-'+$hold.uninstallId)
  if ((Get-FileHash -LiteralPath (Join-Path $history 'maintenance.json')).Hash -cne $hashes[$marker]) {throw 'Archived hold differs.'}
  if ($phase -ne 'archive' -and ((Get-FileHash -LiteralPath (Join-Path $history 'maintenance-shutdown.json')).Hash -cne $hashes[$proofPath] -or -not (Test-Path -LiteralPath (Join-Path $history 'cancellation.json')))) {throw 'Archived cancellation evidence incomplete.'}
  if ([IO.File]::ReadAllText($sample) -cne 'synthetic business data' -or [IO.File]::ReadAllText($archive) -cne 'synthetic archive') {throw 'Business fixture changed.'}
 } finally {
  Microsoft.PowerShell.Management\Remove-Item Function:\Remove-Item -ErrorAction SilentlyContinue
  . (Join-Path $PSScriptRoot 'windows-uninstall-cancellation.ps1')
  if ([IO.Directory]::Exists($fixture)) {Microsoft.PowerShell.Management\Remove-Item -LiteralPath $fixture -Recurse -Force}
 }
}
