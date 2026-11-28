# Disposable persistent switch journal rehearsal. No installation or database access.
param([switch]$Rollback,[switch]$RepairFixture,[switch]$HttpReadiness,[switch]$FailedRollback)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-switch-inspection.ps1')
. (Join-Path $PSScriptRoot 'windows-repair-interruption.ps1')
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
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
 $allowed=@{''=@('prepared');prepared=@('switched');switched=@('completed','rollback-required');'rollback-required'=@('rolled-back','manual-recovery-required')}
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
function Test-ReleaseReadiness([string]$Actual,[string]$Expected) {
 & node (Join-Path $PSScriptRoot 'rehearse-release-http.mjs') $Actual $Expected 2>$null
 if ($LASTEXITCODE -eq 2) {return $false}
 if ($LASTEXITCODE -ne 0) {throw 'HTTP readiness fixture failed.'}
 return $true
}
try {
 if ($RepairFixture) {
  if (-not $Rollback -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {throw 'Disposable repair rollback CI required.'}
  $state=Join-Path $root 'repair-state'
  $control=Join-Path $state 'desktop-control'
  $repairName='repair-preparation-'+[guid]::NewGuid().ToString('N')
  $repair=Join-Path $state $repairName
  $oldRoot=Join-Path $root 'previous-build'
  $newRoot=Join-Path $root 'candidate-build'
  $runtime=Join-Path $root 'fixture-runtime'
  foreach ($dir in @($control,$repair,(Join-Path $oldRoot 'dist'),(Join-Path $newRoot 'dist'),(Join-Path $runtime 'uploads'),(Join-Path $runtime 'backups'))) {
   [void][IO.Directory]::CreateDirectory($dir)
  }
  [IO.File]::WriteAllText((Join-Path $oldRoot 'dist/server.cjs'),'previous fixture')
  [IO.File]::WriteAllText((Join-Path $newRoot 'dist/server.cjs'),'candidate fixture')
  [IO.File]::WriteAllText((Join-Path $runtime '.env.local'),'SYNTHETIC_FIXTURE=true')
  [IO.File]::WriteAllText((Join-Path $runtime 'uploads/sample.txt'),'synthetic upload')
  [IO.File]::WriteAllText((Join-Path $runtime 'backups/sample.txt'),'synthetic archive')
  $old=(Get-ArsPreparedFingerprint $oldRoot).digest
  $new=(Get-ArsPreparedFingerprint $newRoot).digest
  $storage=(Get-ArsPreparedFingerprint $runtime).digest
  $receipt=Join-Path $repair 'rollback-preparation.json'
  Write-New $receipt ([ordered]@{schema=1;kind='windows-repair-rollback-preparation';repairSpecificRollbackTested=$true;previousBuildDigest=$old;activationAllowed=$false;startupAllowed=$false;repairApplied=$false;rollbackAllowed=$false})
  $record=New-ArsRepairInterruptionRecord $repairName ((Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash)
  Write-ArsRepairInterruption $control $record
  $marker=Join-Path $control 'repair-interrupted.json'
  $markerDigest=(Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash
 }
 Write-New $pointer ([ordered]@{schema=1;switchId=$id;digest=$old;activationAllowed=$false})
 Record-Phase 'prepared'
 if ($RepairFixture) {
  $review=Read-ArsRepairInterruptionReview $state
  if ($review.startupAllowed -ne $false -or $review.markerRetained -ne $true) {throw 'Unsafe pre-switch repair state.'}
 }
 Select-Pointer $old $new 'runtime-previous.json'
 $interrupted=Get-ArsSwitchInspection $root
 if ($interrupted.state -cne 'pointer-conflict') {throw 'Interrupted transition not detected.'}
 Record-Phase 'switched'
 if ($HttpReadiness) {
  $candidateVersion=if ($Rollback) {'9.9.9'} else {'1.0.1'}
  $ready=Test-ReleaseReadiness $candidateVersion '1.0.1'
  if ($ready -eq [bool]$Rollback) {throw 'Unexpected candidate readiness result.'}
 }
 if ($Rollback) {
  Record-Phase 'rollback-required'
  Select-Pointer $new $old 'runtime-failed-candidate.json'
  if ($RepairFixture) {
   $review=Read-ArsRepairInterruptionReview $state
   if ($review.startupAllowed -ne $false -or $review.rollbackReceiptMatched -ne $true) {throw 'Unsafe interrupted rollback review.'}
   $active=Get-Content -LiteralPath $pointer -Raw|ConvertFrom-Json
   if ($active.digest -cne $old) {throw 'Previous build pointer not restored.'}
  }
  if ($HttpReadiness) {
   $previousVersion=if ($FailedRollback) {'9.9.8'} else {'1.0.0'}
   $ready=Test-ReleaseReadiness $previousVersion '1.0.0'
   if ($ready -eq [bool]$FailedRollback) {throw 'Unexpected rollback readiness result.'}
  }
  if ($FailedRollback) {
   Record-Phase 'manual-recovery-required'
   $failed=Get-ArsSwitchInspection $root
   if ($failed.state -cne 'manual-recovery-required' -or $failed.phase -cne 'manual-recovery-required' -or $failed.historyVerified -ne $true -or $failed.startupAllowed -ne $false) {throw 'Failed rollback evidence was not classified correctly.'}
   return
  }
  Record-Phase 'rolled-back'
 } else {Record-Phase 'completed'}
 $final=Get-ArsSwitchInspection $root
 if ($final.state -cne 'switch-review-required' -or $final.startupAllowed -ne $false -or $final.historyVerified -ne $true) {throw 'Final review state invalid.'}
 # A writer holding the journal open must prevent a trusted inspection.
 $writer=[IO.File]::Open($journal,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
 try {
  $busy=Get-ArsSwitchInspection $root
  if ($busy.state -cne 'unreadable-or-invalid' -or $busy.startupAllowed -ne $false) {throw 'Busy journal was accepted.'}
 } finally {$writer.Dispose()}
 $afterWriter=Get-ArsSwitchInspection $root
 if ($afterWriter.historyVerified -ne $true) {throw 'Stable evidence not accepted.'}
 # Retained pointer evidence is part of the review, not just the journal.
 $retained=Join-Path $root 'runtime-previous.json'
 $original=[IO.File]::ReadAllBytes($retained)
 [IO.File]::AppendAllText($retained,' ')
 $changed=Get-ArsSwitchInspection $root
 if ($changed.historyVerified -ne $true -or $changed.evidenceInventory -ceq $final.evidenceInventory) {throw 'Retained evidence change not reflected in review.'}
 [IO.File]::WriteAllBytes($retained,$original)
 $restored=Get-ArsSwitchInspection $root
 if ($restored.evidenceInventory -cne $final.evidenceInventory) {throw 'Stable evidence inventory mismatch.'}
 $review=Confirm-ArsSwitchReview $root $final
 if ($review.reviewMatched -ne $true -or $review.startupAllowed -ne $false -or $review.activationAllowed -ne $false -or $review.rollbackAllowed -ne $false) {throw 'Stable read-only review failed.'}
 [IO.File]::AppendAllText($retained,' ')
 try {
  $stale=Confirm-ArsSwitchReview $root $final
  if ($stale.reviewMatched -ne $false -or $stale.startupAllowed -ne $false) {throw 'Stale operator review accepted.'}
 } finally {[IO.File]::WriteAllBytes($retained,$original)}
 $historyVerified=$true
 for ($n=2;$n -le $script:sequence;$n++) {
  $before=Join-Path $root ('journal-history-{0:D4}.json' -f ($n-1))
  $after=if ($n -eq $script:sequence) {$journal} else {Join-Path $root ('journal-history-{0:D4}.json' -f $n)}
  $entry=Get-Content -LiteralPath $after -Raw | ConvertFrom-Json
  if ($entry.previousJournalDigest -cne (Get-FileHash -LiteralPath $before -Algorithm SHA256).Hash) {$historyVerified=$false}
 }
 if (-not $historyVerified) {throw 'Journal chain mismatch.'}
 if ($RepairFixture) {
  if ((Get-ArsPreparedFingerprint $oldRoot).digest -cne $old -or (Get-ArsPreparedFingerprint $newRoot).digest -cne $new -or (Get-ArsPreparedFingerprint $runtime).digest -cne $storage -or (Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash -cne $markerDigest) {throw 'Repair fixture files or marker changed.'}
  $review=Read-ArsRepairInterruptionReview $state
  if ($review.startupAllowed -ne $false -or $review.recoveryAllowed -ne $false) {throw 'Unexpected recovery authorization.'}
  [IO.File]::AppendAllText($receipt,' ')
  $blocked=$false
  try {Read-ArsRepairInterruptionReview $state|Out-Null} catch {$blocked=$true}
  if (-not $blocked -or (Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash -cne $markerDigest) {throw 'Tampered rollback evidence accepted or marker lost.'}
 }
 [ordered]@{schema=1;phase=$script:phase;sequence=$script:sequence;historyVerified=$true;interruptedSwitchDetected=$true;activationAllowed=$false;startupAllowed=$false;rollbackAllowed=$false} | ConvertTo-Json
} finally {
 # Remove only files in the newly created disposable fixture.
 foreach ($file in @(Get-ChildItem -LiteralPath $root -File -Force)) {[IO.File]::Delete($file.FullName)}
 if ($RepairFixture) {
  foreach ($name in @('repair-state','previous-build','candidate-build','fixture-runtime')) {
   $dir=Join-Path $root $name
   if ([IO.Directory]::Exists($dir)) {Remove-Item -LiteralPath $dir -Recurse -Force}
  }
 }
 [IO.Directory]::Delete($root)
}
