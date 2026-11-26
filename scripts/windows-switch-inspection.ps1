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
    $other=@($entries | Where-Object {$_.Name -in @('handoff-pending.json','maintenance-shutdown.json')})
    if ($journal.Count -eq 0 -and $pointer.Count -eq 0 -and $pending.Count -eq 0 -and $other.Count -eq 0) { $blocked.state='no-switch-evidence';return [pscustomobject]$blocked }
    if ($journal.Count -ne 1 -or $pointer.Count -ne 1) { $blocked.state='incomplete-switch-evidence';return [pscustomobject]$blocked }
    foreach ($f in @($journal[0],$pointer[0])) {
      if ($f.PSIsContainer -or $f.Length -lt 1 -or $f.Length -gt 16384 -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid switch evidence.' }
    }
    $jhash=(Get-FileHash -LiteralPath $journal[0].FullName -Algorithm SHA256).Hash
    $phash=(Get-FileHash -LiteralPath $pointer[0].FullName -Algorithm SHA256).Hash
    $j=Get-Content -LiteralPath $journal[0].FullName -Raw | ConvertFrom-Json
    $p=Get-Content -LiteralPath $pointer[0].FullName -Raw | ConvertFrom-Json
    if ($j.schema -ne 1 -or $p.schema -ne 1 -or $j.switchId -cnotmatch '^[a-f0-9]{32}$' -or $j.previousDigest -cnotmatch '^[a-f0-9]{64}$' -or $j.candidateDigest -cnotmatch '^[a-f0-9]{64}$' -or $j.previousDigest -ceq $j.candidateDigest -or $p.switchId -cne $j.switchId -or $p.digest -cnotmatch '^[a-f0-9]{64}$' -or $j.phase -cnotin @('prepared','switched','rollback-required','rolled-back','completed') -or $j.activationAllowed -isnot [bool] -or $j.activationAllowed -or $p.activationAllowed -isnot [bool] -or $p.activationAllowed) { throw 'Invalid switch record.' }
    if ((Get-FileHash -LiteralPath $journal[0].FullName -Algorithm SHA256).Hash -cne $jhash -or (Get-FileHash -LiteralPath $pointer[0].FullName -Algorithm SHA256).Hash -cne $phash) { throw 'Switch evidence changed.' }
    $expected=if ($j.phase -cin @('prepared','rolled-back')) {$j.previousDigest} elseif ($j.phase -cin @('switched','completed')) {$j.candidateDigest} else {''}
    if ($p.digest -cnotin @($j.previousDigest,$j.candidateDigest) -or ($expected -and $p.digest -cne $expected)) { $blocked.state='pointer-conflict' }
    else { $blocked.state='switch-review-required' }
    return [pscustomobject]$blocked
  } catch { return [pscustomobject]$blocked }
}
