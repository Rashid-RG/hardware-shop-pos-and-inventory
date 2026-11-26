# Retain a non-authorizing activation proposal. Never switch runtime or start POS.
param([Parameter(Mandatory=$true)][string]$RecoveryId,[switch]$Verify,[string]$Confirmation)
$ErrorActionPreference='Stop'
if ($RecoveryId -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { throw 'Invalid recovery identifier.' }
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$runtime=Join-Path $state 'runtime-prepared'
$folder=Join-Path (Join-Path $state 'update-recovery') $RecoveryId
$target=Join-Path $control 'runtime-activation-proposal.json'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
function Assert-Chain([string]$Path) {
  $cursor=$Path
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid directory chain.' }
    $cursor=Split-Path -Parent $cursor
  }
}
function Get-PlainHash([string]$Path) {
  Assert-Chain (Split-Path -Parent $Path)
  $item=Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid evidence file.' }
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}
function Get-Snapshot {
  $helper=Join-Path $PSScriptRoot 'plan-windows-runtime-activation.ps1'
  $helperHash=Get-PlainHash $helper
  $files=[ordered]@{
    maintenance=(Join-Path $control 'maintenance.json')
    shutdown=(Join-Path $control 'maintenance-shutdown.json')
    binding=(Join-Path $control 'database-binding.json')
    runtimePreparation=(Join-Path $runtime 'runtime-preparation.json')
    runtimeConfiguration=(Join-Path $runtime '.env.local')
    recovery=(Join-Path $folder 'recovery.json')
    rollback=(Join-Path $folder 'rollback-compatibility-rehearsal.json')
  }
  $hashes=[ordered]@{}
  foreach ($key in $files.Keys) { $hashes[$key]=Get-PlainHash $files[$key] }
  $plan=(@(& $helper -RecoveryId $RecoveryId) -join [Environment]::NewLine) | ConvertFrom-Json
  if ($plan.schema -ne 1 -or $plan.recoveryId -cne $RecoveryId -or $plan.runtimeInventoryMatched -ne $true -or $plan.recoveryEvidenceMatched -ne $true -or $plan.originalDatabaseBindingMatched -ne $true -or $plan.preparedDatabaseBindingMatched -ne $true -or $plan.runtimeActivated -ne $false -or $plan.activationAllowed -ne $false) { throw 'Activation preflight failed.' }
  foreach ($key in $files.Keys) { if ((Get-PlainHash $files[$key]) -cne $hashes[$key]) { throw 'Evidence changed during preflight.' } }
  if ((Get-PlainHash $helper) -cne $helperHash) { throw 'Preflight helper changed.' }
  [ordered]@{schema=1;recoveryId=$RecoveryId;candidateVersion=$plan.candidateVersion;userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;helperHash=$helperHash;evidence=$hashes;runtimeActivated=$false;activationAllowed=$false;startupAllowed=$false;rollbackAllowed=$false}
}
function Assert-MatchingProposal($snapshot) {
  $item=Get-Item -LiteralPath $target -Force
  if ($item.PSIsContainer -or $item.Length -gt 16384 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid proposal.' }
  $before=Get-PlainHash $target
  $record=Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
  if ($record.schema -ne 1 -or $record.kind -cne 'runtime-activation-proposal' -or $record.observationOnly -ne $true -or -not $record.preparedAt) { throw 'Invalid proposal.' }
  if (($record.snapshot | ConvertTo-Json -Depth 6 -Compress) -cne ($snapshot | ConvertTo-Json -Depth 6 -Compress)) { throw 'Activation proposal is stale.' }
  if ((Get-PlainHash $target) -cne $before) { throw 'Proposal changed.' }
  [ordered]@{schema=1;proposalMatched=$true;recoveryId=$RecoveryId;proposalDigest=$before;runtimeActivated=$false;activationAllowed=$false;startupAllowed=$false;rollbackAllowed=$false} | ConvertTo-Json
}
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another maintenance operation is active.' }
  foreach ($dir in @($control,$runtime,$folder,$PSScriptRoot)) { Assert-Chain $dir }
  $snapshot=Get-Snapshot
  if ($Verify) { Assert-MatchingProposal $snapshot; return }
  if (Test-Path -LiteralPath $target) { throw 'Existing proposal must be retained.' }
  if (-not $Confirmation) { $Confirmation=Read-Host 'Type PREPARE RUNTIME ACTIVATION to retain a proposal only' }
  if ($Confirmation -cne 'PREPARE RUNTIME ACTIVATION') { throw 'Explicit confirmation required.' }
  $again=Get-Snapshot
  if (($again | ConvertTo-Json -Depth 6 -Compress) -cne ($snapshot | ConvertTo-Json -Depth 6 -Compress)) { throw 'Activation evidence changed.' }
  $record=[ordered]@{schema=1;kind='runtime-activation-proposal';preparedAt=[DateTime]::UtcNow.ToString('o');observationOnly=$true;snapshot=$again}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Depth 8 -Compress))
  $file=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
  Assert-MatchingProposal (Get-Snapshot)
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
