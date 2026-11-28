$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-installed-lifecycle.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('ars-lifecycle-'+[guid]::NewGuid().ToString('N'))
try {
  $project=Join-Path $root 'project'
  $control=Join-Path $root 'control'
  [void][IO.Directory]::CreateDirectory($project)
  [void][IO.Directory]::CreateDirectory($control)
  [IO.File]::WriteAllText((Join-Path $project 'package.json'),'{"version":"1.2.3"}')
  $binding=Get-ArsInstalledLifecycleBinding $project $control
  if ($binding.version -cne '1.2.3') {throw 'Installed package binding failed.'}
  $rejected=$false
  try {$null=New-ArsInstalledLifecycle $project $control '1.2.4'} catch {$rejected=$true}
  if (-not $rejected) {throw 'Wrong installed version accepted.'}
  $hold=Join-Path $control 'maintenance.json'
  $done=Join-Path $control 'maintenance-shutdown.json'
  $record=@{schema=1;project=$project;pid=123;startedUtc='12345';shutdownVerified=$false;activationApproved=$false}
  [IO.File]::WriteAllText($hold,($record|ConvertTo-Json))
  $rejected=$false
  try {Assert-ArsInstalledLifecycleStart $binding} catch {if ($_.Exception.Message -like '*Retained evidence*') {$rejected=$true}}
  if (-not $rejected) {throw 'Maintenance startup protection failed.'}
  $record.shutdownVerified=$true
  $record.pid=124
  [IO.File]::WriteAllText($done,($record|ConvertTo-Json))
  $rejected=$false
  try {$null=Assert-ArsInstalledLifecycleStopped $binding} catch {if ($_.Exception.Message -like '*evidence mismatch*') {$rejected=$true}}
  if (-not $rejected) {throw 'Conflicting shutdown identity accepted.'}
  $record.pid=123
  [IO.File]::WriteAllText($done,($record|ConvertTo-Json))
  [IO.File]::WriteAllText((Join-Path $control 'instance.json'),'{}')
  $rejected=$false
  try {$null=Assert-ArsInstalledLifecycleStopped $binding} catch {if ($_.Exception.Message -like '*Instance evidence*') {$rejected=$true}}
  if (-not $rejected) {throw 'Retained instance accepted.'}
} finally {if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}}
