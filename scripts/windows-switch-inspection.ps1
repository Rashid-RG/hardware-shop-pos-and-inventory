# Read-only inspection; no pointer creation, switching, rollback or startup.
function Read-ArsSwitchSnapshot([string]$Path) {
  $f=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($f.PSIsContainer -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Invalid evidence file.'}
  $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
    if ($stream.Length -lt 1 -or $stream.Length -gt 16384) {throw 'Invalid evidence size.'}
    $bytes=New-Object byte[] ([int]$stream.Length)
    $offset=0
    while ($offset -lt $bytes.Length) {
      $count=$stream.Read($bytes,$offset,$bytes.Length-$offset)
      if ($count -le 0) {throw 'Incomplete evidence.'}
      $offset+=$count
    }
    if ($stream.ReadByte() -ne -1) {throw 'Evidence grew.'}
    $sha=[Security.Cryptography.SHA256]::Create()
    try {$digest=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','')} finally {$sha.Dispose()}
    $encoding=New-Object Text.UTF8Encoding($false,$true)
    $record=$encoding.GetString($bytes).TrimStart([char]0xFEFF)|ConvertFrom-Json -ErrorAction Stop
    return [pscustomobject]@{digest=$digest;record=$record}
  } finally {$stream.Dispose()}
}

function Get-ArsSwitchEvidenceInventory([string]$Control) {
  $files=@(Get-ChildItem -LiteralPath $Control -Force -ErrorAction Stop | Where-Object {
    $_.Name -in @('runtime-switch-journal.json','runtime-active.json','runtime-previous.json',
      'runtime-failed-candidate.json','handoff-pending.json','maintenance-shutdown.json',
      'maintenance.json','runtime-switch-intent.json','runtime-activation-interrupted.json','repair-interrupted.json') -or
    $_.Name -like 'runtime-switch-pending-*' -or $_.Name -like 'journal-history-*'
  } | Sort-Object Name)
  if ($files.Count -gt 32) {throw 'Too many switch evidence files.'}
  $inventory=[ordered]@{}
  foreach ($file in $files) {
    $inventory[$file.Name]=(Read-ArsSwitchSnapshot $file.FullName).digest
  }
  return ($inventory|ConvertTo-Json -Compress)
}

function Get-ArsSwitchInspection([string]$Control) {
  $blocked=[ordered]@{schema=1;state='unreadable-or-invalid';startupAllowed=$false;activationAllowed=$false;rollbackAllowed=$false}
  try {
    $cursor=[IO.Path]::GetFullPath($Control)
    while ($cursor) {
      $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
      if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid directory.' }
      $cursor=Split-Path -Parent $cursor
    }
    $entries=@(Get-ChildItem -LiteralPath $Control -Force -ErrorAction Stop)
    $journal=@($entries | Where-Object {$_.Name -ieq 'runtime-switch-journal.json'})
    $pointer=@($entries | Where-Object {$_.Name -ieq 'runtime-active.json'})
    $pending=@($entries | Where-Object {$_.Name -like 'runtime-switch-pending-*' -or $_.Name -ieq 'runtime-previous.json' -or $_.Name -ieq 'runtime-failed-candidate.json'})
    $history=@($entries | Where-Object {$_.Name -like 'journal-history-*'})
    $other=@($entries | Where-Object {$_.Name -in @('handoff-pending.json','maintenance-shutdown.json','runtime-switch-intent.json','runtime-activation-interrupted.json')})
    if ($journal.Count -eq 0 -and $pointer.Count -eq 0 -and $pending.Count -eq 0 -and $history.Count -eq 0 -and $other.Count -eq 0) { $blocked.state='no-switch-evidence';return [pscustomobject]$blocked }
    if ($journal.Count -ne 1 -or $pointer.Count -ne 1) { $blocked.state='incomplete-switch-evidence';return [pscustomobject]$blocked }
    foreach ($f in @($journal[0],$pointer[0])) {
      if ($f.PSIsContainer -or $f.Length -lt 1 -or $f.Length -gt 16384 -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid switch evidence.' }
    }
    $inventory=Get-ArsSwitchEvidenceInventory $Control
    $journalSnapshot=Read-ArsSwitchSnapshot $journal[0].FullName
    $pointerSnapshot=Read-ArsSwitchSnapshot $pointer[0].FullName
    $jhash=$journalSnapshot.digest
    $phash=$pointerSnapshot.digest
    $j=$journalSnapshot.record
    $p=$pointerSnapshot.record
    if ($j.schema -ne 1 -or $p.schema -ne 1 -or $j.switchId -cnotmatch '^[a-f0-9]{32}$' -or $j.previousDigest -cnotmatch '^[a-f0-9]{64}$' -or $j.candidateDigest -cnotmatch '^[a-f0-9]{64}$' -or $j.previousDigest -ceq $j.candidateDigest -or $p.switchId -cne $j.switchId -or $p.digest -cnotmatch '^[a-f0-9]{64}$' -or $j.phase -cnotin @('prepared','switched','rollback-required','rolled-back','completed','manual-recovery-required') -or $j.activationAllowed -isnot [bool] -or $j.activationAllowed -or $p.activationAllowed -isnot [bool] -or $p.activationAllowed) { throw 'Invalid switch record.' }
    if ((Read-ArsSwitchSnapshot $journal[0].FullName).digest -cne $jhash -or (Read-ArsSwitchSnapshot $pointer[0].FullName).digest -cne $phash) { throw 'Switch evidence changed.' }
    # Retained pointer records must describe the same switch and release.
    # A prepared journal may legitimately have a previous pointer if power
    # failed after pointer replacement but before the journal advanced.
    foreach ($name in @('runtime-previous.json','runtime-failed-candidate.json')) {
      $retained=@($pending | Where-Object {$_.Name -ieq $name})
      $required=if ($name -eq 'runtime-previous.json') {$j.phase -cne 'prepared' -or $p.digest -ceq $j.candidateDigest} else {$j.phase -cin @('rolled-back','manual-recovery-required') -or ($j.phase -ceq 'rollback-required' -and $p.digest -ceq $j.previousDigest)}
      if ($retained.Count -gt 1 -or ($required -and $retained.Count -ne 1)) {throw 'Missing or ambiguous retained pointer.'}
      if ($retained.Count -eq 1) {
        $r=(Read-ArsSwitchSnapshot $retained[0].FullName).record
        $digest=if ($name -eq 'runtime-previous.json') {$j.previousDigest} else {$j.candidateDigest}
        if ($r.schema -ne 1 -or $r.switchId -cne $j.switchId -or $r.digest -cne $digest -or $r.activationAllowed -isnot [bool] -or $r.activationAllowed) {throw 'Retained pointer binding mismatch.'}
        if ($name -eq 'runtime-failed-candidate.json' -and $j.phase -cnotin @('rollback-required','rolled-back','manual-recovery-required')) {throw 'Unexpected failed candidate evidence.'}
      }
    }
    # Require the complete bounded sequence, including the retained old records.
    if ($j.sequence -isnot [int] -or $j.sequence -lt 1 -or $j.sequence -gt 4 -or $history.Count -ne ($j.sequence-1)) { throw 'Invalid switch history length.' }
    $transitions=@{''=@('prepared');prepared=@('switched');switched=@('completed','rollback-required');'rollback-required'=@('rolled-back','manual-recovery-required')}
    $lastPhase=''
    $lastHash=''
    $hashes=[ordered]@{}
    for ($n=1;$n -le $j.sequence;$n++) {
      $path=if ($n -eq $j.sequence) {$journal[0].FullName} else {Join-Path $Control ('journal-history-{0:D4}.json' -f $n)}
      $f=Get-Item -LiteralPath $path -Force -ErrorAction Stop
      if ($f.PSIsContainer -or $f.Length -lt 1 -or $f.Length -gt 16384 -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Invalid history file.'}
      $snapshot=Read-ArsSwitchSnapshot $path
      $hash=$snapshot.digest
      $record=$snapshot.record
      if ($record.schema -ne 1 -or $record.sequence -ne $n -or $record.switchId -cne $j.switchId -or $record.previousDigest -cne $j.previousDigest -or $record.candidateDigest -cne $j.candidateDigest -or $record.activationAllowed -isnot [bool] -or $record.activationAllowed -or $record.previousJournalDigest -isnot [string] -or $record.previousJournalDigest -cne $lastHash -or -not $transitions.ContainsKey($lastPhase) -or $record.phase -cnotin $transitions[$lastPhase]) {throw 'Invalid history transition.'}
      $hashes[$path]=$hash
      $lastHash=$hash
      $lastPhase=$record.phase
    }
    if ($lastHash -cne $jhash -or $lastPhase -cne $j.phase) {throw 'Journal head changed.'}
    foreach ($path in $hashes.Keys) {
      if ((Read-ArsSwitchSnapshot $path).digest -cne $hashes[$path]) {throw 'History changed.'}
    }
    $again=@(Get-ChildItem -LiteralPath $Control -Force -ErrorAction Stop | Where-Object {$_.Name -like 'journal-history-*'})
    if ($again.Count -ne $history.Count -or (Read-ArsSwitchSnapshot $pointer[0].FullName).digest -cne $phash) {throw 'Switch evidence changed.'}
    if ((Get-ArsSwitchEvidenceInventory $Control) -cne $inventory) {throw 'Switch evidence inventory changed.'}
    # Classify the two known atomic pointer-replacement interruption windows.
    # This is diagnostic only; no journal advancement or pointer write.
    $blocked['interruptionBoundary']='none'
    $hasPrevious=@($pending | Where-Object {$_.Name -ieq 'runtime-previous.json'}).Count -eq 1
    $hasFailed=@($pending | Where-Object {$_.Name -ieq 'runtime-failed-candidate.json'}).Count -eq 1
    $hasPending=@($pending | Where-Object {$_.Name -like 'runtime-switch-pending-*'}).Count -gt 0
    if (-not $hasPending -and $other.Count -eq 0) {
      if ($j.phase -ceq 'prepared' -and $p.digest -ceq $j.candidateDigest -and $hasPrevious -and -not $hasFailed) {
        $blocked.interruptionBoundary='forward-pointer-replaced'
      } elseif ($j.phase -ceq 'rollback-required' -and $p.digest -ceq $j.previousDigest -and $hasPrevious -and $hasFailed) {
        $blocked.interruptionBoundary='rollback-pointer-replaced'
      }
    }
    $blocked['evidenceInventory']=$inventory
    $blocked['historyVerified']=$true
    $blocked['phase']=$j.phase
    $expected=if ($j.phase -cin @('prepared','rolled-back','manual-recovery-required')) {$j.previousDigest} elseif ($j.phase -cin @('switched','completed')) {$j.candidateDigest} else {''}
    if ($p.digest -cnotin @($j.previousDigest,$j.candidateDigest) -or ($expected -and $p.digest -cne $expected)) { $blocked.state='pointer-conflict' }
    elseif (@($pending | Where-Object {$_.Name -like 'runtime-switch-pending-*'}).Count -gt 0) { $blocked.state='pending-switch-evidence' }
    elseif ($j.phase -ceq 'manual-recovery-required') { $blocked.state='manual-recovery-required' }
    else { $blocked.state='switch-review-required' }
    return [pscustomobject]$blocked
  } catch { return [pscustomobject]$blocked }
}

# Read-only comparison. Neither matching nor stale evidence authorizes startup.
function Confirm-ArsSwitchReview([string]$Control,$Reviewed) {
  $result=[ordered]@{schema=1;reviewMatched=$false;startupAllowed=$false;activationAllowed=$false;rollbackAllowed=$false}
  if ($null -eq $Reviewed -or $Reviewed.historyVerified -ne $true -or
      [string]::IsNullOrWhiteSpace($Reviewed.evidenceInventory)) {return [pscustomobject]$result}
  $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
  $owned=$false
  try {
    try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true;return [pscustomobject]$result}
    if (-not $owned) {return [pscustomobject]$result}
    $current=Get-ArsSwitchInspection $Control
    $result.reviewMatched=($current.historyVerified -eq $true -and
      $current.state -ceq $Reviewed.state -and $current.phase -ceq $Reviewed.phase -and
      $current.interruptionBoundary -ceq $Reviewed.interruptionBoundary -and
      $current.evidenceInventory -ceq $Reviewed.evidenceInventory)
    return [pscustomobject]$result
  } finally {
    if ($owned) {$mutex.ReleaseMutex()}
    $mutex.Dispose()
  }
}


# Verify a retained local recovery-tool binding without granting execution.
function Get-ArsRecoveryTrustReview([string]$Control,[string]$Scripts) {
  $result=[ordered]@{schema=1;toolsMatched=$false;startupAllowed=$false;activationAllowed=$false;rollbackAllowed=$false}
  try {
    $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
    $owned=$false
    try {
      try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true;return [pscustomobject]$result}
      if (-not $owned) {return [pscustomobject]$result}
      $path=Join-Path $Control 'runtime-switch-intent.json'
      $before=Read-ArsSwitchSnapshot $path
      $intent=$before.record
      if ($intent.schema -ne 1 -or $intent.kind -cne 'runtime-switch-intent' -or $intent.switchId -cnotmatch '^[a-f0-9]{32}$' -or $intent.observationOnly -isnot [bool] -or -not $intent.observationOnly) {return [pscustomobject]$result}
      foreach ($flag in @('startupAllowed','activationAllowed','rollbackAllowed')) {
        if ($intent.$flag -isnot [bool] -or $intent.$flag) {return [pscustomobject]$result}
      }
      $expected=$intent.binding.previousRecoveryToolsDigest
      if ($expected -cnotmatch '^[a-f0-9]{64}$') {return [pscustomobject]$result}
      $first=Get-ArsRecoveryToolsFingerprint $Scripts
      $second=Get-ArsRecoveryToolsFingerprint $Scripts
      $result.toolsMatched=($first -ceq $expected -and $second -ceq $first -and (Read-ArsSwitchSnapshot $path).digest -ceq $before.digest)
      if ($result.toolsMatched) {
        $result['intentDigest']=$before.digest
        $result['toolsDigest']=$first
      }
      return [pscustomobject]$result
    } finally {
      if ($owned) {$mutex.ReleaseMutex()}
      $mutex.Dispose()
    }
  } catch {return [pscustomobject]$result}
}


# One locked comparison binds the operator review to both journal evidence and
# recovery tools. A missing or legacy intent cannot authenticate recovery code.
function Confirm-ArsRecoveryEvidenceReview([string]$Control,[string]$Scripts,$Reviewed,$Trust) {
  $result=[ordered]@{schema=1;reviewMatched=$false;toolsMatched=$false;startupAllowed=$false;activationAllowed=$false;rollbackAllowed=$false}
  if ($null -eq $Reviewed -or $null -eq $Trust) {return [pscustomobject]$result}
  $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
  $owned=$false
  try {
    try {$owned=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owned=$true;return [pscustomobject]$result}
    if (-not $owned) {return [pscustomobject]$result}
    $inventory=Get-ArsSwitchEvidenceInventory $Control
    $current=Get-ArsSwitchInspection $Control
    if ($current.state -cne $Reviewed.state -or $current.phase -cne $Reviewed.phase -or $current.interruptionBoundary -cne $Reviewed.interruptionBoundary -or $current.historyVerified -ne $Reviewed.historyVerified -or $current.evidenceInventory -cne $Reviewed.evidenceInventory) {return [pscustomobject]$result}
    $again=Get-ArsRecoveryTrustReview $Control $Scripts
    $result.toolsMatched=($Trust.toolsMatched -eq $true -and $again.toolsMatched -eq $true -and $again.intentDigest -ceq $Trust.intentDigest -and $again.toolsDigest -ceq $Trust.toolsDigest)
    if ($Trust.toolsMatched -eq $true -and -not $result.toolsMatched) {return [pscustomobject]$result}
    if ((Get-ArsSwitchEvidenceInventory $Control) -cne $inventory) {return [pscustomobject]$result}
    if ($Reviewed.historyVerified -eq $true) {
      $result.reviewMatched=($current.evidenceInventory -ceq $inventory)
    } elseif ($result.toolsMatched) {
      $result.reviewMatched=$true
    }
    return [pscustomobject]$result
  } catch {return [pscustomobject]$result} finally {
    if ($owned) {$mutex.ReleaseMutex()}
    $mutex.Dispose()
  }
}
