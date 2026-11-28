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
 $dockerOverrides=@('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH') | Where-Object {
  $null -ne [Environment]::GetEnvironmentVariable($_,'Process')
 }
 if ($dockerOverrides) { $dockerStatus='unsupported' }
 if ($docker -and $dockerStatus -ne 'unsupported') {
  $dockerStatus='installed'
  $endpoint=@(& docker context inspect --format '{{.Endpoints.docker.Host}}' 2>$null)
  if ($LASTEXITCODE -eq 0 -and ($endpoint.Count -ne 1 -or $endpoint[0] -cnotin @('npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine'))) {
   $dockerStatus='unsupported'
  } elseif ($LASTEXITCODE -eq 0) {
   $os=@(& docker info --format '{{.OSType}}' 2>$null)
   if ($LASTEXITCODE -eq 0) {
    $dockerStatus='unsupported'
    if ($os.Count -eq 1 -and $os[0] -ceq 'linux') {
     & docker compose version 2>$null | Out-Null
     if ($LASTEXITCODE -eq 0) { $dockerStatus='ready' }
    }
   }
  }
 }
 [pscustomobject]@{Node=$nodeStatus;Docker=$dockerStatus;WinGet=[bool](Get-Command winget -ErrorAction SilentlyContinue)}
}
function Install-ArsMissingPrerequisites {
 $plan=Get-ArsPrerequisitePlan
 if ($plan.Node -eq 'incompatible') { throw 'Existing Node.js is incompatible or incomplete. Setup will not replace it automatically.' }
 if ($plan.Node -eq 'ready' -and $plan.Docker -eq 'ready') { return $true }
 if ($plan.Docker -eq 'unsupported') { throw 'Setup requires local Docker Desktop in Linux-container mode with Compose v2 and no Docker connection overrides.' }
 if ($plan.Docker -eq 'installed') { throw 'Start the existing Docker Desktop and finish its first-run setup, then reopen Setup.' }
 if (-not $plan.WinGet) { throw 'Windows Package Manager is unavailable. Install Microsoft App Installer, then reopen Setup.' }
 $missing=@()
 if ($plan.Node -eq 'missing') { $missing+='Node.js 22' }
 if ($plan.Docker -eq 'missing') { $missing+='Docker Desktop' }
 $message='Setup can download the following missing prerequisites through Windows Package Manager: '+($missing -join ', ')+'. Publisher installers may request permission, license acceptance or restart. Continue?'
 if ([System.Windows.Forms.MessageBox]::Show($message,$title,'YesNo','Question') -ne 'Yes') { return $false }
 # Explicit source and exact IDs; no hash bypass or blanket license acceptance.
 if ($plan.Node -eq 'missing') {
  Invoke-ArsSetupStage 'prerequisite-node'
 }
 if ($plan.Docker -eq 'missing') {
  Invoke-ArsSetupStage 'prerequisite-docker'
 }
 Offer-ArsSetupResume
 [void][System.Windows.Forms.MessageBox]::Show('Prerequisite installation steps completed. Restart Windows if requested, start Docker Desktop and finish its first-run prompts, then reopen ARS Setup. No ARS database has been created.',$title,'OK','Information')
 return $false
}
