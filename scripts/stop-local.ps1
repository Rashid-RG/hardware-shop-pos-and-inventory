param([switch]$DesktopLaunch,[switch]$Maintenance,[switch]$UninstallPreparation,[string]$UninstallConfirmation)
if ($UninstallPreparation -and ($DesktopLaunch -or -not $Maintenance -or $UninstallConfirmation -cne 'STOP POS FOR UNINSTALL BACKUP')) {throw 'Explicit internal uninstall shutdown confirmation required.'}
$ErrorActionPreference = 'Stop'
try {
  $mutex = New-Object System.Threading.Mutex($false, 'Local\ARSDistributorPOSLauncher')
  $owns = $false
  try {
    try { $owns = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns = $true; if ($UninstallPreparation) {throw 'Interrupted maintenance requires review.'} }
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
    if ($UninstallPreparation) {
      . (Join-Path $PSScriptRoot 'windows-installation-identity.ps1')
      . (Join-Path $PSScriptRoot 'windows-desktop-registration.ps1')
      . (Join-Path $PSScriptRoot 'windows-uninstall-shutdown.ps1')
      $control=Split-Path -Parent $recordPath
      $state=Split-Path -Parent $control
      foreach ($path in @($root,$state,$control,$recordPath)) {Assert-ArsPlainPath $path}
      $markers=@('maintenance.json','maintenance-shutdown.json','activation.json','runtime-active.json','runtime-switch-intent.json','runtime-switch-journal.json','runtime-activation-interrupted.json','runtime-migration-interrupted.json','handoff-pending.json','switch-journal.json','repair-interrupted.json')
      if (@(Get-ChildItem -LiteralPath $control -Force -ErrorAction Stop|Where-Object Name -in $markers).Count) {throw 'Existing maintenance evidence requires review.'}
      $instanceDigest=(Get-FileHash -LiteralPath $recordPath -Algorithm SHA256).Hash
      $null=Review-ArsInstallationIdentity $root $state
      $null=Review-ArsDesktopRegistration $root $state ([Environment]::GetFolderPath('DesktopDirectory')) ([Environment]::GetFolderPath('Programs'))
      if ((Get-FileHash -LiteralPath $recordPath -Algorithm SHA256).Hash -cne $instanceDigest -or $process.HasExited -or $process.StartTime.ToUniversalTime().Ticks.ToString() -cne $record.startedUtc) {throw 'Application identity changed.'}
    } elseif ($DesktopLaunch) {
      Add-Type -AssemblyName System.Windows.Forms
      $answer=[System.Windows.Forms.MessageBox]::Show('Finish all sales, payments and shift operations before stopping ARS. Request graceful shutdown now?','ARS Distributor POS','YesNo','Question')
      if ($answer -ne 'Yes') { return }
    } elseif ((Read-Host 'Type SHUTDOWN after completing all operations') -cne 'SHUTDOWN') { return }
    if ($Maintenance) {
      $maintenancePath=Join-Path (Split-Path -Parent $recordPath) 'maintenance.json'
      $maintenance=[ordered]@{schema=1;project=$root;pid=$process.Id;startedUtc=$record.startedUtc;requestedAt=[DateTime]::UtcNow.ToString('o');shutdownVerified=$false;activationApproved=$false}
      if ($UninstallPreparation) {$maintenance=New-ArsUninstallShutdownHold $root $record $UninstallConfirmation}
      $stream=[IO.File]::Open($maintenancePath,[IO.FileMode]::CreateNew)
      try {
        $bytes=[Text.Encoding]::UTF8.GetBytes(($maintenance | ConvertTo-Json))
        $stream.Write($bytes,0,$bytes.Length)
        $stream.Flush($true)
      } finally { $stream.Dispose() }
    }
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
    if ($Maintenance) {
      # Publish completion separately. A failed or interrupted write leaves the original block in place.
      $verifiedPath=Join-Path (Split-Path -Parent $recordPath) 'maintenance-shutdown.json'
      if ($UninstallPreparation) {
        if ((Get-FileHash -LiteralPath $recordPath -Algorithm SHA256).Hash -cne $instanceDigest) {throw 'Instance evidence changed.'}
        $null=Review-ArsInstallationIdentity $root $state
        $null=Review-ArsDesktopRegistration $root $state ([Environment]::GetFolderPath('DesktopDirectory')) ([Environment]::GetFolderPath('Programs'))
      }
      $maintenance.shutdownVerified=$true
      $maintenance.completedAt=[DateTime]::UtcNow.ToString('o')
      $stream=[IO.File]::Open($verifiedPath,[IO.FileMode]::CreateNew)
      try {
        $bytes=[Text.Encoding]::UTF8.GetBytes(($maintenance | ConvertTo-Json))
        $stream.Write($bytes,0,$bytes.Length)
        $stream.Flush($true)
      } finally { $stream.Dispose() }
    }
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
