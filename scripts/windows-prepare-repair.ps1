# Isolated exact-package repair preparation; never activate, build or modify live files.
. (Join-Path $PSScriptRoot 'windows-setup-destination.ps1')
function Get-ArsRepairMetadataHash([string]$folder,[string]$name) {
 $path=Join-Path $folder $name
 Assert-ArsPlainPath $path
 if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Repair package metadata missing.' }
 (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
function Prepare-ArsRepair([string]$project,[string]$source,[string]$state) {
 $project=[IO.Path]::GetFullPath($project).TrimEnd('\')
 $source=[IO.Path]::GetFullPath($source).TrimEnd('\')
 $state=[IO.Path]::GetFullPath($state).TrimEnd('\')
 foreach ($path in @($project,$source,$state)) { Assert-ArsPlainPath $path }
 foreach ($pair in @(@($project,$source),@($state,$source))) {
  $a=$pair[0]; $b=$pair[1]
  if ($a -ieq $b -or $a.StartsWith($b+'\',[StringComparison]::OrdinalIgnoreCase) -or $b.StartsWith($a+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Choose separate extracted repair media.' }
 }
 $control=Join-Path $state 'desktop-control'
 if (Test-Path -LiteralPath $control) {
  Assert-ArsPlainPath $control
  foreach ($name in @('runtime-activation-interrupted.json','runtime-switch-intent.json','runtime-migration-interrupted.json','handoff-pending.json','switch-journal.json')) {
   if (@(Get-ChildItem -LiteralPath $control -Force | Where-Object Name -eq $name).Count) { throw 'Unresolved maintenance evidence. Repair preparation blocked.' }
  }
 }
 $manifest=Get-ArsRepairMetadataHash $project 'PILOT-FILES.json'
 $release=Get-ArsRepairMetadataHash $project 'PILOT-RELEASE.json'
 if ((Get-ArsRepairMetadataHash $source 'PILOT-FILES.json') -cne $manifest -or (Get-ArsRepairMetadataHash $source 'PILOT-RELEASE.json') -cne $release) { throw 'Exact installed package and release identity required.' }
 $folder=Join-Path $state ('repair-preparation-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $folder -ErrorAction Stop | Out-Null
 $candidate=Join-Path $folder 'candidate'
 Copy-ArsPilotRelease $source $candidate
 if ((Get-ArsRepairMetadataHash $candidate 'PILOT-FILES.json') -cne $manifest -or (Get-ArsRepairMetadataHash $candidate 'PILOT-RELEASE.json') -cne $release -or (Get-ArsRepairMetadataHash $project 'PILOT-FILES.json') -cne $manifest -or (Get-ArsRepairMetadataHash $project 'PILOT-RELEASE.json') -cne $release) { throw 'Repair metadata changed during preparation.' }
 $receipt=[ordered]@{schema=1;manifestSha256=$manifest.ToLowerInvariant();releaseSha256=$release.ToLowerInvariant();candidate=$candidate;sourceVerified=$true;backupVerified=$false;activationAllowed=$false;startupAllowed=$false;repairApplied=$false}
 $stream=[IO.File]::Open((Join-Path $folder 'repair-preparation.json'),[IO.FileMode]::CreateNew)
 try {
  $bytes=[Text.Encoding]::UTF8.GetBytes(($receipt | ConvertTo-Json))
  $stream.Write($bytes,0,$bytes.Length)
  $stream.Flush($true)
 } finally { $stream.Dispose() }
 return $folder
}
