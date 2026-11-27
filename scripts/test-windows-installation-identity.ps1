$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-installation-identity.ps1')
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('ars-identity-ci-'+[guid]::NewGuid().ToString('N'))
$project=Join-Path $fixture 'app'
$state=Join-Path $fixture 'state'
try {
 foreach ($p in @($state,(Join-Path $project 'dist'),(Join-Path $project 'scripts'),(Join-Path $project 'uploads'))) {[void][IO.Directory]::CreateDirectory($p)}
 $manifest=[ordered]@{}
 foreach ($name in @('package.json','package-lock.json','PILOT-RELEASE.json','scripts/setup-wizard.ps1','Launch-Hardware-POS.vbs','dist/server.cjs','dist/index.html')) {
  $path=Join-Path $project $name
  [IO.File]::WriteAllText($path,'fixture')
  if (-not $name.StartsWith('dist/')) {$manifest[$name]=@{sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}}
 }
 [IO.File]::WriteAllText((Join-Path $project 'PILOT-FILES.json'),($manifest|ConvertTo-Json -Depth 4))
 Write-ArsInstallationIdentity $project $state
 [IO.File]::WriteAllText((Join-Path $project 'uploads/sample.txt'),'business fixture')
 $result=Review-ArsInstallationIdentity $project $state
 if (-not $result.installationIdentityMatched -or $result.applicationRemovalAllowed) {throw 'Invalid identity result.'}
 [IO.File]::WriteAllText((Join-Path $project 'unrelated.txt'),'retain')
 $blocked=$false
 try {Review-ArsInstallationIdentity $project $state|Out-Null} catch {$blocked=$true}
 if (-not $blocked) {throw 'Unexpected file not detected.'}
} finally {if ([IO.Directory]::Exists($fixture)) {Remove-Item -LiteralPath $fixture -Recurse -Force}}
