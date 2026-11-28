# Persistent interruption evidence; no live repair or marker clearing.
. (Join-Path $PSScriptRoot 'windows-setup-destination.ps1')
function Assert-ArsRepairInterruption($record) {
 if ($record.schema -ne 1 -or $record.kind -cne 'windows-repair-interruption' -or $record.phase -cne 'pre-activation' -or $record.repairFolder -cnotmatch '^repair-preparation-[a-f0-9]{32}$' -or $record.rollbackReceiptDigest -cnotmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid interruption evidence.' }
 foreach ($flag in @('activationAllowed','startupAllowed','repairApplied','rollbackAllowed')) {
  if ($record.$flag -isnot [bool] -or $record.$flag) { throw 'Unexpected authorization.' }
 }
}
function Read-ArsInterruptionFile([string]$path) {
 Assert-ArsPlainPath $path
 $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 try {
  if ($stream.Length -le 0 -or $stream.Length -gt 65536) { throw 'Invalid evidence size.' }
  $reader=New-Object IO.StreamReader($stream)
  try { $reader.ReadToEnd() } finally { $reader.Dispose() }
 } finally { $stream.Dispose() }
}
function New-ArsRepairInterruptionRecord([string]$folder,[string]$digest) {
 $record=[ordered]@{schema=1;kind='windows-repair-interruption';phase='pre-activation';repairFolder=$folder;rollbackReceiptDigest=$digest;createdAt=[DateTime]::UtcNow.ToString('o');activationAllowed=$false;startupAllowed=$false;repairApplied=$false;rollbackAllowed=$false}
 Assert-ArsRepairInterruption $record
 return $record
}
function Write-ArsRepairInterruption([string]$control,$record) {
 # Internal primitive for a future coordinator holding the launcher mutex.
 # Not called by the GUI; no live activation is authorized.
 Assert-ArsPlainPath $control
 Assert-ArsRepairInterruption $record
 $target=Join-Path $control 'repair-interrupted.json'
 $bytes=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Depth 5))
 $stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try { $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true) } finally { $stream.Dispose() }
}
function Read-ArsRepairInterruptionReview([string]$state) {
 Assert-ArsPlainPath $state
 $marker=Join-Path $state 'desktop-control\repair-interrupted.json'
 $raw=Read-ArsInterruptionFile $marker
 $record=$raw|ConvertFrom-Json
 Assert-ArsRepairInterruption $record
 $receipt=Join-Path (Join-Path $state $record.repairFolder) 'rollback-preparation.json'
 $before=(Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash
 $receiptRaw=Read-ArsInterruptionFile $receipt
 $rollback=$receiptRaw|ConvertFrom-Json
 if ($before -ine $record.rollbackReceiptDigest -or $rollback.schema -ne 1 -or $rollback.kind -cne 'windows-repair-rollback-preparation' -or $rollback.repairSpecificRollbackTested -isnot [bool] -or -not $rollback.repairSpecificRollbackTested) { throw 'Rollback evidence mismatch.' }
 foreach ($flag in @('activationAllowed','startupAllowed','repairApplied','rollbackAllowed')) {
  if ($rollback.$flag -isnot [bool] -or $rollback.$flag) { throw 'Unexpected rollback authorization.' }
 }
 if ((Read-ArsInterruptionFile $marker) -cne $raw -or (Read-ArsInterruptionFile $receipt) -cne $receiptRaw -or (Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash -ine $before) { throw 'Evidence changed.' }
 [ordered]@{schema=1;kind='windows-repair-interruption-review';markerRetained=$true;rollbackReceiptMatched=$true;recoveryAllowed=$false;activationAllowed=$false;startupAllowed=$false;repairApplied=$false;rollbackAllowed=$false}
}
function Review-ArsRepairInterruption {
 $state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
 $mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
 $owned=$false
 try {
  try { $owned=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true; throw 'Interrupted maintenance requires review.' }
  if (-not $owned) { throw 'Maintenance is active.' }
  Read-ArsRepairInterruptionReview $state
 } finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
 }
}
