# Read-only inspection; no pointer creation, switching, rollback or startup.
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
    $other=@($entries | Where-Object {$_.Name -in @('handoff-pending.json','maintenance-shutdown.json','runtime-switch-intent.json')})
    if ($journal.Count -eq 0 -and $pointer.Count -eq 0 -and $pending.Count -eq 0 -and $history.Count -eq 0 -and $other.Count -eq 0) { $blocked.state='no-switch-evidence';return [pscustomobject]$blocked }
    if ($journal.Count -ne 1 -or $pointer.Count -ne 1) { $blocked.state='incomplete-switch-evidence';return [pscustomobject]$blocked }
    foreach ($f in @($journal[0],$pointer[0])) {
      if ($f.PSIsContainer -or $f.Length -lt 1 -or $f.Length -gt 16384 -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid switch evidence.' }
    }
    $jhash=(Get-FileHash -LiteralPath $journal[0].FullName -Algorithm SHA256).Hash
    $phash=(Get-FileHash -LiteralPath $pointer[0].FullName -Algorithm SHA256).Hash
    $j=Get-Content -LiteralPath $journal[0].FullName -Raw | ConvertFrom-Json
    $p=Get-Content -LiteralPath $pointer[0].FullName -Raw | ConvertFrom-Json
    if ($j.schema -ne 1 -or $p.schema -ne 1 -or $j.switchId -cnotmatch '^[a-f0-9]{32}$' -or $j.previousDigest -cnotmatch '^[a-f0-9]{64}$' -or $j.candidateDigest -cnotmatch '^[a-f0-9]{64}$' -or $j.previousDigest -ceq $j.candidateDigest -or $p.switchId -cne $j.switchId -or $p.digest -cnotmatch '^[a-f0-9]{64}$' -or $j.phase -cnotin @('prepared','switched','rollback-required','rolled-back','completed','manual-recovery-required') -or $j.activationAllowed -isnot [bool] -or $j.activationAllowed -or $p.activationAllowed -isnot [bool] -or $p.activationAllowed) { throw 'Invalid switch record.' }
    if ((Get-FileHash -LiteralPath $journal[0].FullName -Algorithm SHA256).Hash -cne $jhash -or (Get-FileHash -LiteralPath $pointer[0].FullName -Algorithm SHA256).Hash -cne $phash) { throw 'Switch evidence changed.' }
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
      $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
      $record=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      if ($record.schema -ne 1 -or $record.sequence -ne $n -or $record.switchId -cne $j.switchId -or $record.previousDigest -cne $j.previousDigest -or $record.candidateDigest -cne $j.candidateDigest -or $record.activationAllowed -isnot [bool] -or $record.activationAllowed -or $record.previousJournalDigest -isnot [string] -or $record.previousJournalDigest -cne $lastHash -or -not $transitions.ContainsKey($lastPhase) -or $record.phase -cnotin $transitions[$lastPhase]) {throw 'Invalid history transition.'}
      $hashes[$path]=$hash
      $lastHash=$hash
      $lastPhase=$record.phase
    }
    if ($lastHash -cne $jhash -or $lastPhase -cne $j.phase) {throw 'Journal head changed.'}
    foreach ($path in $hashes.Keys) {
      if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $hashes[$path]) {throw 'History changed.'}
    }
    $again=@(Get-ChildItem -LiteralPath $Control -Force -ErrorAction Stop | Where-Object {$_.Name -like 'journal-history-*'})
    if ($again.Count -ne $history.Count -or (Get-FileHash -LiteralPath $pointer[0].FullName -Algorithm SHA256).Hash -cne $phash) {throw 'Switch evidence changed.'}
    $blocked['historyVerified']=$true
    $expected=if ($j.phase -cin @('prepared','rolled-back','manual-recovery-required')) {$j.previousDigest} elseif ($j.phase -cin @('switched','completed')) {$j.candidateDigest} else {''}
    if ($p.digest -cnotin @($j.previousDigest,$j.candidateDigest) -or ($expected -and $p.digest -cne $expected)) { $blocked.state='pointer-conflict' }
    else { $blocked.state='switch-review-required' }
    return [pscustomobject]$blocked
  } catch { return [pscustomobject]$blocked }
}
