# Installed desktop lifecycle adapter. Does not authorize switching releases,
# bypass maintenance evidence or start a replacement database.
function Assert-ArsAdapterPlainPath([string]$Path) {
  $cursor=[IO.Path]::GetFullPath($Path)
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Linked installed lifecycle path.'}
    $cursor=Split-Path -Parent $cursor
  }
}
function New-ArsInstalledLifecycle([string]$Project,[string]$Control,[string]$Version) {
  $Project=[IO.Path]::GetFullPath($Project)
  $Control=[IO.Path]::GetFullPath($Control)
  Assert-ArsAdapterPlainPath $Project
  Assert-ArsAdapterPlainPath $Control
  if ($Version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') {throw 'Invalid installed version.'}
  $package=Join-Path $Project 'package.json'
  Assert-ArsAdapterPlainPath $package
  if ((Get-Item -LiteralPath $package).Length -gt 65536 -or (Get-Content -LiteralPath $package -Raw|ConvertFrom-Json).version -cne $Version) {throw 'Installed version mismatch.'}
  [pscustomobject]@{project=$Project;control=$Control;version=$Version}
}
function Assert-ArsInstalledLifecycleStart($Binding) {
  $null=New-ArsInstalledLifecycle $Binding.project $Binding.control $Binding.version
  $blocked=@(Get-ChildItem -LiteralPath $Binding.control -Force -ErrorAction Stop | Where-Object {
    $_.Name -in @('maintenance.json','maintenance-shutdown.json','activation.json','handoff-pending.json','runtime-switch-intent.json','runtime-switch-journal.json','runtime-active.json','runtime-previous.json','runtime-failed-candidate.json','repair-interrupted.json','runtime-activation-interrupted.json','runtime-migration-interrupted.json','instance.json') -or
    $_.Name -like 'runtime-switch-pending-*' -or $_.Name -like 'journal-history-*'
  })
  if ($blocked.Count) {throw 'Retained evidence blocks installed startup.'}
  foreach ($name in @('.env.local','dist/server.cjs','dist/index.html','scripts/start-local.ps1','scripts/stop-local.ps1')) {
    $path=Join-Path $Binding.project $name
    Assert-ArsAdapterPlainPath $path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {throw 'Required installed file missing.'}
  }
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {throw 'Existing POS port listener.'}
}
function Assert-ArsAdapterDefaultControl($Binding) {
  $expected=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\desktop-control'
  if ($Binding.control -ine [IO.Path]::GetFullPath($expected)) {throw 'Unexpected installed control directory.'}
}
function Start-ArsInstalledLifecycle($Binding) {
  Assert-ArsAdapterDefaultControl $Binding
  Assert-ArsInstalledLifecycleStart $Binding
  # The ordinary launcher independently checks startup markers and owns
  # the launcher mutex. It is never invoked with an activation bypass.
  & (Join-Path $Binding.project 'scripts/start-local.ps1') -DesktopLaunch
}
function Stop-ArsInstalledLifecycle($Binding) {
  Assert-ArsAdapterDefaultControl $Binding
  $null=New-ArsInstalledLifecycle $Binding.project $Binding.control $Binding.version
  $script=Join-Path $Binding.project 'scripts/stop-local.ps1'
  Assert-ArsAdapterPlainPath $script
  # Existing graceful named-pipe shutdown prompts for operator consent.
  # Do not force-kill the POS or stop PostgreSQL.
  & $script -DesktopLaunch -Maintenance
}
function Assert-ArsInstalledLifecycleStopped($Binding) {
  $null=New-ArsInstalledLifecycle $Binding.project $Binding.control $Binding.version
  foreach ($name in @('maintenance.json','maintenance-shutdown.json')) {
    $path=Join-Path $Binding.control $name
    Assert-ArsAdapterPlainPath $path
    if ((Get-Item -LiteralPath $path).Length -gt 8192) {throw 'Invalid shutdown evidence size.'}
  }
  $hold=Get-Content -LiteralPath (Join-Path $Binding.control 'maintenance.json') -Raw|ConvertFrom-Json
  $done=Get-Content -LiteralPath (Join-Path $Binding.control 'maintenance-shutdown.json') -Raw|ConvertFrom-Json
  if ($hold.schema -ne 1 -or $done.schema -ne 1 -or $hold.project -ine $Binding.project -or $done.project -ine $Binding.project -or $hold.pid -ne $done.pid -or $hold.startedUtc -cne $done.startedUtc -or $hold.shutdownVerified -ne $false -or $done.shutdownVerified -ne $true -or $hold.activationApproved -ne $false -or $done.activationApproved -ne $false) {throw 'Shutdown evidence mismatch.'}
  if (Test-Path -LiteralPath (Join-Path $Binding.control 'instance.json')) {throw 'Instance evidence remains.'}
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {throw 'POS port still listening.'}
  $true
}
