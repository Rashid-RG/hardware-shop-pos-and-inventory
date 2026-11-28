$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-uninstall-preview.ps1')
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('ars-uninstall-ci-'+[guid]::NewGuid().ToString('N'))
$project=Join-Path $fixture 'application'
$state=Join-Path $fixture 'state'
try {
 foreach ($name in @((Join-Path $project 'dist'),(Join-Path $project 'uploads'),(Join-Path $project 'backups'),(Join-Path $state 'desktop-control'))) {
  [void][IO.Directory]::CreateDirectory($name)
 }
 foreach ($name in @('dist/server.cjs','dist/index.html','.env.local','uploads/sample.txt','backups/sample.txt')) {
  [IO.File]::WriteAllText((Join-Path $project $name),'synthetic fixture')
 }
 $plan=Get-ArsUninstallPreview $project $state
 if ($plan.businessStorageInsideApplication -ne $true) { throw 'Embedded storage was not detected.' }
 foreach ($flag in @('permanentStorageSeparationVerified','installationOwnershipCertified','backupVerified','applicationRemovalAllowed','serviceRemovalAllowed','databaseDeletionAllowed','uninstalled')) {
  if ($plan[$flag] -isnot [bool] -or $plan[$flag]) { throw 'Unsafe removal plan.' }
 }
 $marker=Join-Path $state 'desktop-control\repair-interrupted.json'
 [IO.File]::WriteAllText($marker,'{')
 $blocked=$false
 try { Get-ArsUninstallPreview $project $state|Out-Null } catch {$blocked=$true}
 if (-not $blocked) {throw 'Interrupted repair was not detected.'}
 if ([IO.File]::ReadAllText($marker) -cne '{' -or [IO.File]::ReadAllText((Join-Path $project 'backups/sample.txt')) -cne 'synthetic fixture') {throw 'Fixture data changed.'}
} finally {
 if ([IO.Directory]::Exists($fixture)) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
