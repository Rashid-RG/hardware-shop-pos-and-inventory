param([switch]$DesktopLaunch)
$ErrorActionPreference = 'Stop'
try {
  $mutex = New-Object System.Threading.Mutex($false, 'Local\ARSDistributorPOSLauncher')
  $owns = $false
  try {
    try { $owns = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns = $true }
    if (-not $owns) { throw 'ARS startup is in progress. Wait for startup to finish before shutdown.' }
    $listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
      throw 'Port 3000 is still listening. No process or database was stopped. Finish all transactions and sign out. Stop a development server from its own terminal; for desktop production use, close Windows normally or contact support for a controlled shutdown.'
    }
    # Do not stop PostgreSQL: other clients or background jobs may still use it.
    $message = 'No application listener detected on port 3000. PostgreSQL was left running. You may shut down Windows normally after finishing all work.'
    Write-Host $message
    if ($DesktopLaunch) {
      Add-Type -AssemblyName System.Windows.Forms
      [void][System.Windows.Forms.MessageBox]::Show($message,'ARS Distributor POS','OK','Information')
    }
  } finally {
    if ($owns) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
} catch {
  if ($DesktopLaunch) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'ARS Distributor POS','OK','Warning')
    exit 1
  }
  throw
}
