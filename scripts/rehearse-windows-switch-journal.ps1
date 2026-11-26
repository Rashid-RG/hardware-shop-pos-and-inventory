# Disposable persistent switch journal rehearsal. No installation or database access.
param([switch]$Rollback)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-switch-inspection.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('ars-switch-journal-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$journal=Join-Path $root 'runtime-switch-journal.json'
$pointer=Join-Path $root 'runtime-active.json'
$id=[guid]::NewGuid().ToString('N')
$old='a'*64
$new='b'*64
$utf8=New-Object Text.UTF8Encoding($false)
$script:phase=''
$script:sequence=0
$script:lastDigest=''
function Write-New([string]$Path,$Value) {
 $bytes=$utf8.GetBytes(($Value | ConvertTo-Json -Compress -Depth 5))
 $file=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try {$file.Write($bytes,0,$bytes.Length);$file.Flush($true)} finally {$file.Dispose()}
}
function Record-Phase([string]$Next) {
 $allowed=@{''=@('prepared');prepared=@('switched');switched=@('completed','rollback-required');'rollback-required'=@('rolled-back')}
 if (-not $allowed.ContainsKey($script:phase) -or $Next -cnotin $allowed[$script:phase]) { throw 'Invalid rehearsal transition.' }
 if ($script:sequence -gt 0 -and (Get-FileHash -LiteralPath $journal -Algorithm SHA256).Hash -cne $script:lastDigest) { throw 'Journal changed.' }
 $number=$script:sequence+1
 $record=[ordered]@{schema=1;switchId=$id;previousDigest=$old;candidateDigest=$new;phase=$Next;sequence=$number;previousJournalDigest=$script:lastDigest;activationAllowed=$false}
 $pending=Join-Path $root ('runtime-switch-pending-'+[guid]::NewGuid().ToString('N')+'.json')
 Write-New $pending $record
 if ($number -eq 1) {[IO.File]::Move($pending,$journal)}
 else {
  $history=Join-Path $root ('journal-history-{0:D4}.json' -f $script:sequence)
  if (Test-Path -LiteralPath $history) {throw 'History already exists.'}
  [IO.File]::Replace($pending,$journal,$history)
  if ((Get-FileHash -LiteralPath $history -Algorithm SHA256).Hash -cne $script:lastDigest) {throw 'Previous record mismatch.'}
 }
 $script:lastDigest=(Get-FileHash -LiteralPath $journal -Algorithm SHA256).Hash
 $script:sequence=$number
 $script:phase=$Next
}
function Select-Pointer([string]$Expected,[string]$Next,[string]$Retained) {
 $current=Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json
 if ($current.digest -cne $Expected -or $current.switchId -cne $id) {throw 'Unexpected pointer.'}
 $pending=Join-Path $root ('runtime-switch-pending-'+[guid]::NewGuid().ToString('N')+'.json')
 Write-New $pending ([ordered]@{schema=1;switchId=$id;digest=$Next;activationAllowed=$false})
 [IO.File]::Replace($pending,$pointer,(Join-Path $root $Retained))
}
try {
 Write-New $pointer ([ordered]@{schema=1;switchId=$id;digest=$old;activationAllowed=$false})
 Record-Phase 'prepared'
 Select-Pointer $old $new 'runtime-previous.json'
 $interrupted=Get-ArsSwitchInspection $root
 if ($interrupted.state -cne 'pointer-conflict') {throw 'Interrupted transition not detected.'}
 Record-Phase 'switched'
 if ($Rollback) {
  Record-Phase 'rollback-required'
  Select-Pointer $new $old 'runtime-failed-candidate.json'
  Record-Phase 'rolled-back'
 } else {Record-Phase 'completed'}
 $final=Get-ArsSwitchInspection $root
 if ($final.state -cne 'switch-review-required' -or $final.startupAllowed -ne $false) {throw 'Final review state invalid.'}
 $historyVerified=$true
 for ($n=2;$n -le $script:sequence;$n++) {
  $before=Join-Path $root ('journal-history-{0:D4}.json' -f ($n-1))
  $after=if ($n -eq $script:sequence) {$journal} else {Join-Path $root ('journal-history-{0:D4}.json' -f $n)}
  $entry=Get-Content -LiteralPath $after -Raw | ConvertFrom-Json
  if ($entry.previousJournalDigest -cne (Get-FileHash -LiteralPath $before -Algorithm SHA256).Hash) {$historyVerified=$false}
 }
 if (-not $historyVerified) {throw 'Journal chain mismatch.'}
 [ordered]@{schema=1;phase=$script:phase;sequence=$script:sequence;historyVerified=$true;interruptedSwitchDetected=$true;activationAllowed=$false;startupAllowed=$false;rollbackAllowed=$false} | ConvertTo-Json
} finally {
 # Remove only files in the newly created disposable fixture.
 foreach ($file in @(Get-ChildItem -LiteralPath $root -File -Force)) {[IO.File]::Delete($file.FullName)}
 [IO.Directory]::Delete($root)
}
