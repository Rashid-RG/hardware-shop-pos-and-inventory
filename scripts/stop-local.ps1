param([switch]$DesktopLaunch)
$ErrorActionPreference = 'Stop'
try {
  $mutex = New-Object System.Threading.Mutex($false, 'Local\ARSDistributorPOSLauncher')
  $owns = $false
  try {
    try { $owns = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns = $true }
    if (-not $owns) { throw 'ARS startup is in progress. Wait for startup to finish before shutdown.' }
    $listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    $root=Split-Path -Parent $PSScriptRoot
    $recordPath=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\desktop-control\instance.json'
    if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) {
      if ($listeners.Count -gt 0) { throw 'Port 3000 is still listening. No managed desktop identity found; no process or database was stopped.' }
      throw 'No managed desktop identity found. Shutdown completion cannot be verified.'
    }
    $item=Get-Item -LiteralPath $recordPath -Force
    if ($item.Length -gt 8192 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid desktop control record.' }
    $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    if ($record.schema -ne 1 -or $record.project -ine $root -or $record.pipe -cnotmatch '^ars-pos-[a-f0-9]{32}$') { throw 'Desktop control identity mismatch.' }
    $process=Get-Process -Id ([int]$record.pid) -ErrorAction Stop
    if ($process.StartTime.ToUniversalTime().Ticks.ToString() -cne $record.startedUtc -or $process.ProcessName -ine 'node' -or $listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $process.Id) { throw 'Desktop process identity mismatch; no shutdown requested.' }
    if ($DesktopLaunch) {
      Add-Type -AssemblyName System.Windows.Forms
      $answer=[System.Windows.Forms.MessageBox]::Show('Finish all sales, payments and shift operations before stopping ARS. Request graceful shutdown now?','ARS Distributor POS','YesNo','Question')
      if ($answer -ne 'Yes') { return }
    } elseif ((Read-Host 'Type SHUTDOWN after completing all operations') -cne 'SHUTDOWN') { return }
    $secure=ConvertTo-SecureString $record.protectedSecret
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $secret=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $pipe=New-Object IO.Pipes.NamedPipeClientStream('.', $record.pipe, [IO.Pipes.PipeDirection]::InOut)
    try {
      $pipe.Connect(3000)
      $bytes=[Text.Encoding]::UTF8.GetBytes($secret+[char]10)
      $pipe.Write($bytes,0,$bytes.Length)
      $pipe.Flush()
      $reader=New-Object IO.StreamReader($pipe)
      $task=$reader.ReadLineAsync()
      if (-not $task.Wait(5000)) { throw 'Shutdown acknowledgement timed out.' }
      if ($task.Result -cne 'SHUTDOWN_REQUESTED') { throw 'Shutdown not accepted. Review transactions before retrying.' }
    } finally { $pipe.Dispose() }
    if (-not $process.WaitForExit(120000)) { throw 'Graceful shutdown remains pending. No process was forcibly terminated.' }
    if ($process.ExitCode -ne 0) { throw 'Application did not exit successfully; maintenance remains unverified.' }
    if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'Another application listener exists. Maintenance remains unverified.' }
    Remove-Item -LiteralPath $recordPath
    $message='Managed ARS application exited successfully. PostgreSQL was left running.'
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
