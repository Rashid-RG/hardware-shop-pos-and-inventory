# Dedicated application-mode window; retain Chromium's security sandbox.
function Open-ArsDesktopWindow {
 $candidates=@()
 foreach ($base in @($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA)) {
  if ($base) {
   $candidates+=Join-Path $base 'Microsoft\Edge\Application\msedge.exe'
   $candidates+=Join-Path $base 'Google\Chrome\Application\chrome.exe'
  }
 }
 $browser=$candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
 if (-not $browser) { throw 'A supported Edge or Chrome installation is required for the ARS desktop window.' }
 $profile=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\desktop-profile'
 [void][IO.Directory]::CreateDirectory($profile)
 $cursor=$profile
 while ($cursor) {
  if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected linked desktop profile.' }
  $cursor=Split-Path -Parent $cursor
 }
 $arguments='--app=http://localhost:3000 --user-data-dir="'+$profile+'" --no-first-run --no-default-browser-check'
 $process=Start-Process -FilePath $browser -ArgumentList $arguments -PassThru
 if ($process.WaitForExit(1000) -and $process.ExitCode -ne 0) { throw 'ARS desktop window could not open.' }
}
