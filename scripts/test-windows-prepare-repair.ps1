$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prepare-repair.ps1')
$fixture=Join-Path $env:RUNNER_TEMP ('ars-repair-'+[guid]::NewGuid())
$source=Join-Path $fixture 'source'
$project=Join-Path $fixture 'active'
$state=Join-Path $fixture 'state'
foreach ($path in @($source,$project,$state)) { [void][IO.Directory]::CreateDirectory($path) }
try {
 $manifest=[ordered]@{}
 foreach ($name in @('package.json','package-lock.json','scripts/setup-wizard.ps1','Launch-Hardware-POS.vbs','PILOT-RELEASE.json')) {
  $file=Join-Path $source $name
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $file))
  [IO.File]::WriteAllText($file,$name)
  $manifest[$name]=@{sha256=(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant();mode=420}
 }
 $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $source 'PILOT-FILES.json')
 foreach ($name in @('PILOT-FILES.json','PILOT-RELEASE.json')) {
  Copy-Item -LiteralPath (Join-Path $source $name) -Destination $project
 }
 [IO.File]::WriteAllText((Join-Path $project 'package.json'),'damaged')
 $folder=Prepare-ArsRepair $project $source $state
 $receipt=Get-Content -LiteralPath (Join-Path $folder 'repair-preparation.json') -Raw | ConvertFrom-Json
 if ($receipt.activationAllowed -ne $false -or $receipt.backupVerified -ne $false -or $receipt.repairApplied -ne $false) { throw 'Unsafe repair authorization.' }
 if ([IO.File]::ReadAllText((Join-Path $project 'package.json')) -cne 'damaged' -or [IO.File]::ReadAllText((Join-Path $folder 'candidate/package.json')) -cne 'package.json') { throw 'Isolation failed.' }
 [IO.File]::WriteAllText((Join-Path $source 'PILOT-RELEASE.json'),'different')
 $blocked=$false
 try { Prepare-ArsRepair $project $source $state } catch { $blocked=$true }
 if (-not $blocked) { throw 'Mismatched release was accepted.' }
} finally { Remove-Item -LiteralPath $fixture -Recurse -Force }
