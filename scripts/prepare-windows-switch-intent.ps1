# Retain a switch intent only. Never create an active pointer or start the POS.
param([Parameter(Mandatory=$true)][string]$RecoveryId,[switch]$Verify,[string]$Confirmation)
$ErrorActionPreference='Stop'
if ($RecoveryId -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') {throw 'Invalid recovery identifier.'}
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$target=Join-Path $control 'runtime-switch-intent.json'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
function Assert-Chain([string]$Path) {
 $cursor=$Path
 while ($cursor) {
  $item=Get-Item -LiteralPath $cursor -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Invalid intent directory.'}
  $cursor=Split-Path -Parent $cursor
 }
}
function Read-Record([string]$Path) {
 $f=Get-Item -LiteralPath $Path -Force
 if ($f.PSIsContainer -or $f.Length -lt 1 -or $f.Length -gt 16384 -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Invalid intent evidence.'}
 $hash=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
 $data=Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
 if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -cne $hash) {throw 'Intent evidence changed.'}
 return [pscustomobject]@{data=$data;digest=$hash}
}
function Get-VerifiedBinding {
 $helper=Join-Path $PSScriptRoot 'prepare-windows-runtime-activation.ps1'
 $h=Get-Item -LiteralPath $helper -Force
 if ($h.PSIsContainer -or ($h.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Invalid proposal verifier.'}
 $verified=(@(& $helper -RecoveryId $RecoveryId -Verify) -join [Environment]::NewLine) | ConvertFrom-Json
 if ($verified.schema -ne 1 -or $verified.proposalMatched -ne $true -or $verified.recoveryId -cne $RecoveryId -or $verified.proposalDigest -cnotmatch '^[A-F0-9]{64}$' -or $verified.activationAllowed -ne $false -or $verified.runtimeActivated -ne $false -or $verified.startupAllowed -ne $false -or $verified.rollbackAllowed -ne $false) {throw 'Verified non-authorizing proposal required.'}
 $proposal=Read-Record (Join-Path $control 'runtime-activation-proposal.json')
 if ($proposal.digest -cne $verified.proposalDigest -or $proposal.data.snapshot.userSid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {throw 'Proposal identity changed.'}
 $folder=Join-Path (Join-Path $state 'update-recovery') $RecoveryId
 Assert-Chain $folder
 $meta=Read-Record (Join-Path $folder 'recovery.json')
 $rollback=Read-Record (Join-Path $folder 'rollback-compatibility-rehearsal.json')
 if ($meta.digest -cne $proposal.data.snapshot.evidence.recovery -or $rollback.digest -cne $proposal.data.snapshot.evidence.rollback -or $meta.data.preparedDigest -cnotmatch '^[a-f0-9]{64}$' -or $rollback.data.previousBuildDigest -cnotmatch '^[a-f0-9]{64}$') {throw 'Release evidence changed.'}
 return [ordered]@{recoveryId=$RecoveryId;proposalDigest=$proposal.digest;candidateDigest=$meta.data.preparedDigest;previousBuildDigest=$rollback.data.previousBuildDigest;maintenanceDigest=$proposal.data.snapshot.evidence.maintenance;userSid=$proposal.data.snapshot.userSid}
}
try {
 try {$owns=$mutex.WaitOne(0)} catch [System.Threading.AbandonedMutexException] {$owns=$true}
 if (-not $owns) {throw 'Another maintenance operation is active.'}
 Assert-Chain $control
 Assert-Chain $PSScriptRoot
 $conflicts=@(Get-ChildItem -LiteralPath $control -Force | Where-Object {$_.Name -in @('runtime-active.json','runtime-switch-journal.json','handoff-pending.json','runtime-previous.json','runtime-failed-candidate.json') -or $_.Name -like 'journal-history-*' -or $_.Name -like 'runtime-switch-pending-*'})
 if ($conflicts.Count -gt 0) {throw 'Unresolved switching evidence.'}
 $binding=Get-VerifiedBinding
 if (-not $Verify) {
  if (Test-Path -LiteralPath $target) {throw 'Existing switch intent must be retained.'}
  if (-not $Confirmation) {$Confirmation=Read-Host 'Type RETAIN SWITCH INTENT to record intent only'}
  if ($Confirmation -cne 'RETAIN SWITCH INTENT') {throw 'Explicit confirmation required.'}
  $again=Get-VerifiedBinding
  if (($binding | ConvertTo-Json -Compress) -cne ($again | ConvertTo-Json -Compress)) {throw 'Verified binding changed.'}
  $record=[ordered]@{schema=1;kind='runtime-switch-intent';switchId=[guid]::NewGuid().ToString('N');recordedAt=[DateTime]::UtcNow.ToString('o');binding=$again;observationOnly=$true;activationAllowed=$false;startupAllowed=$false;rollbackAllowed=$false}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Depth 5 -Compress))
  $file=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$file.Write($bytes,0,$bytes.Length);$file.Flush($true)} finally {$file.Dispose()}
 }
 $saved=Read-Record $target
 $current=Get-VerifiedBinding
 if ($saved.data.schema -ne 1 -or $saved.data.kind -cne 'runtime-switch-intent' -or $saved.data.switchId -cnotmatch '^[a-f0-9]{32}$' -or $saved.data.observationOnly -ne $true -or $saved.data.activationAllowed -ne $false -or $saved.data.startupAllowed -ne $false -or $saved.data.rollbackAllowed -ne $false -or ($saved.data.binding | ConvertTo-Json -Compress) -cne ($current | ConvertTo-Json -Compress) -or (Read-Record $target).digest -cne $saved.digest) {throw 'Switch intent invalid or stale.'}
 [ordered]@{schema=1;intentMatched=$true;switchId=$saved.data.switchId;intentDigest=$saved.digest;activationAllowed=$false;startupAllowed=$false;rollbackAllowed=$false} | ConvertTo-Json
} finally {
 if ($owns) {$mutex.ReleaseMutex()}
 $mutex.Dispose()
}
