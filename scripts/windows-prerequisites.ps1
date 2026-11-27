# Windows dependency bootstrap: install missing components only, never upgrade in place.
function Get-ArsPrerequisitePlan {
 $node=Get-Command node -ErrorAction SilentlyContinue
 $npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
 $docker=Get-Command docker -ErrorAction SilentlyContinue
 $nodeStatus='missing'
 if ($node) {
  $version=& node -p 'process.versions.node'
  if ($LASTEXITCODE -ne 0) { $nodeStatus='incompatible' }
  elseif ($version -match '^22\.(\d+)\.\d+$' -and [int]$Matches[1] -ge 12 -and $npm) { $nodeStatus='ready' }
  else { $nodeStatus='incompatible' }
 } elseif ($npm) { $nodeStatus='incompatible' }
 $dockerStatus='missing'
 if ($docker) {
  $dockerStatus='installed'
  & docker info --format '{{.OSType}}' 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $dockerStatus='ready' }
 }
 [pscustomobject]@{Node=$nodeStatus;Docker=$dockerStatus;WinGet=[bool](Get-Command winget -ErrorAction SilentlyContinue)}
}
function Install-ArsMissingPrerequisites {
 $plan=Get-ArsPrerequisitePlan
 if ($plan.Node -eq 'incompatible') { throw 'Existing Node.js is incompatible or incomplete. Setup will not replace it automatically.' }
 if ($plan.Node -eq 'ready' -and $plan.Docker -eq 'ready') { return $true }
 if ($plan.Docker -eq 'installed') { throw 'Start the existing Docker Desktop and finish its first-run setup, then reopen Setup.' }
 if (-not $plan.WinGet) { throw 'Windows Package Manager is unavailable. Install Microsoft App Installer, then reopen Setup.' }
 $missing=@()
 if ($plan.Node -eq 'missing') { $missing+='Node.js 22' }
 if ($plan.Docker -eq 'missing') { $missing+='Docker Desktop' }
 $message='Setup can download the following missing prerequisites through Windows Package Manager: '+($missing -join ', ')+'. Publisher installers may request permission, license acceptance or restart. Continue?'
 if ([System.Windows.Forms.MessageBox]::Show($message,$title,'YesNo','Question') -ne 'Yes') { return $false }
 # Explicit source and exact IDs; no hash bypass or blanket license acceptance.
 if ($plan.Node -eq 'missing') {
  & winget install --id OpenJS.NodeJS.22 --exact --source winget --interactive
  if ($LASTEXITCODE -ne 0) { throw 'Node.js installation did not complete. Reopen Setup after resolving the publisher prompt.' }
 }
 if ($plan.Docker -eq 'missing') {
  & winget install --id Docker.DockerDesktop --exact --source winget --interactive
  if ($LASTEXITCODE -ne 0) { throw 'Docker installation did not complete. Reopen Setup after resolving the publisher prompt.' }
 }
 Offer-ArsSetupResume
 [void][System.Windows.Forms.MessageBox]::Show('Prerequisite installation steps completed. Restart Windows if requested, start Docker Desktop and finish its first-run prompts, then reopen ARS Setup. No ARS database has been created.',$title,'OK','Information')
 return $false
}
