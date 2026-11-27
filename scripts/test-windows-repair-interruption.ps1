$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-repair-interruption.ps1')
$state=Join-Path $env:RUNNER_TEMP ('ars-interruption-'+[guid]::NewGuid().ToString('N'))
$folder='repair-preparation-'+[guid]::NewGuid().ToString('N')
$control=Join-Path $state 'desktop-control'
New-Item -ItemType Directory -Path $control,(Join-Path $state $folder) -Force|Out-Null
try {
 $receipt=Join-Path (Join-Path $state $folder) 'rollback-preparation.json'
 $r=[ordered]@{schema=1;kind='windows-repair-rollback-preparation';repairSpecificRollbackTested=$true;activationAllowed=$false;startupAllowed=$false;repairApplied=$false;rollbackAllowed=$false}
 [IO.File]::WriteAllText($receipt,($r|ConvertTo-Json))
 $record=New-ArsRepairInterruptionRecord $folder ((Get-FileHash -LiteralPath $receipt -Algorithm SHA256).Hash)
 Write-ArsRepairInterruption $control $record
 $result=Read-ArsRepairInterruptionReview $state
 if (-not $result.markerRetained -or $result.startupAllowed -ne $false) { throw 'Unsafe review result.' }
 $blocked=$false
 try { Write-ArsRepairInterruption $control $record } catch { $blocked=$true }
 if (-not $blocked) { throw 'Marker overwrite accepted.' }
 [IO.File]::AppendAllText($receipt,' ')
 $blocked=$false
 try { Read-ArsRepairInterruptionReview $state } catch { $blocked=$true }
 if (-not $blocked -or -not (Test-Path -LiteralPath (Join-Path $control 'repair-interrupted.json'))) { throw 'Tampered evidence accepted or marker lost.' }
} finally { Remove-Item -LiteralPath $state -Recurse -Force }
