# Cancel verified pre-activation maintenance. Never restore a database or switch releases.
param([switch]$DesktopLaunch)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$control=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\desktop-control'
$marker=Join-Path $control 'maintenance.json'
$proof=Join-Path $control 'maintenance-shutdown.json'
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  foreach ($path in @($control,$marker,$proof)) {
    $item=Get-Item -LiteralPath $path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected maintenance reparse point.' }
  }
  $m=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  $v=Get-Content -LiteralPath $proof -Raw | ConvertFrom-Json
  if ($null -ne $m.purpose -or $null -ne $v.purpose) {throw 'Dedicated uninstall maintenance requires its own cancellation procedure.'}
  if ($m.schema -ne 1 -or $v.schema -ne 1 -or $m.project -ine $root -or $v.project -ine $root -or $m.pid -ne $v.pid -or $m.startedUtc -cne $v.startedUtc -or $m.requestedAt -cne $v.requestedAt -or $m.shutdownVerified -ne $false -or $v.shutdownVerified -ne $true -or $m.activationApproved -ne $false -or $v.activationApproved -ne $false) { throw 'Matching verified pre-activation shutdown required. Contact support for interrupted maintenance.' }
  if (Test-Path -LiteralPath (Join-Path $control 'instance.json')) { throw 'Managed instance remains; cancellation blocked.' }
  if (Test-Path -LiteralPath (Join-Path $control 'activation.json')) { throw 'Activation evidence exists; use dedicated recovery procedure.' }
  if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'Application listener exists; cancellation blocked.' }
  $old=Get-Process -Id ([int]$m.pid) -ErrorAction SilentlyContinue
  if ($old -and $old.StartTime.ToUniversalTime().Ticks.ToString() -ceq $m.startedUtc) { throw 'Previous application process remains active.' }
  foreach ($relative in @('.env.local','dist/server.cjs','dist/index.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) { throw 'Existing installation is incomplete; cancellation blocked.' }
  }
  if ($DesktopLaunch) {
    Add-Type -AssemblyName System.Windows.Forms
    if ([System.Windows.Forms.MessageBox]::Show('Cancel update preparation and permit the existing ARS version to start? Recovery backups will be retained.','ARS Distributor POS','YesNo','Question') -ne 'Yes') { return }
  } elseif ((Read-Host 'Type CANCEL MAINTENANCE to resume the existing installation') -cne 'CANCEL MAINTENANCE') { return }
  $history=Join-Path $control ('cancelled-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $history | Out-Null
  Copy-Item -LiteralPath $marker -Destination (Join-Path $history 'maintenance.json')
  Copy-Item -LiteralPath $proof -Destination (Join-Path $history 'maintenance-shutdown.json')
  foreach ($path in @($marker,$proof)) {
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath (Join-Path $history ([IO.Path]::GetFileName($path))) -Algorithm SHA256).Hash) { throw 'Maintenance evidence archive verification failed.' }
  }
  $receipt=[ordered]@{schema=1;project=$root;cancelledAt=[DateTime]::UtcNow.ToString('o');activationApproved=$false;databaseRestored=$false;releaseSwitched=$false}
  $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $history 'cancellation.json') -Encoding UTF8
  # Remove the launch block last. Any interruption before this point remains blocked.
  Remove-Item -LiteralPath $proof
  Remove-Item -LiteralPath $marker
  Write-Host 'Maintenance cancelled. Existing version may be started using the normal launcher. All recovery archives retained.'
  if ($DesktopLaunch) { [void][System.Windows.Forms.MessageBox]::Show('Maintenance cancelled. Open ARS Distributor normally.','ARS Distributor POS','OK','Information') }
} catch {
  if ($DesktopLaunch) { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'ARS Distributor POS','OK','Warning'); exit 1 }
  throw
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
