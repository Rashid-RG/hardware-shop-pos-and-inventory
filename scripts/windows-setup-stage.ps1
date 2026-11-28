# Run long, fixed setup commands while the graphical thread pumps messages.
# No arbitrary shell text, no secret-bearing command arguments, no forced cancellation.
function Invoke-ArsSetupStage([string]$stage) {
 $processInfo=New-Object Diagnostics.ProcessStartInfo
 $processInfo.WorkingDirectory=$root
 $processInfo.UseShellExecute=$false
 $processInfo.CreateNoWindow=$true
 switch ($stage) {
  'prerequisite-node' {
   $processInfo.FileName=(Get-Command winget.exe -CommandType Application -ErrorAction Stop).Source
   $processInfo.Arguments='install --id OpenJS.NodeJS.22 --exact --source winget --interactive'
   $processInfo.CreateNoWindow=$false
  }
  'prerequisite-docker' {
   $processInfo.FileName=(Get-Command winget.exe -CommandType Application -ErrorAction Stop).Source
   $processInfo.Arguments='install --id Docker.DockerDesktop --exact --source winget --interactive'
   $processInfo.CreateNoWindow=$false
  }
  'dependencies' {
   $processInfo.FileName=Join-Path $env:SystemRoot 'System32\cmd.exe'
   $processInfo.Arguments='/d /c npm.cmd ci --include=dev'
  }
  'build' {
   $processInfo.FileName=Join-Path $env:SystemRoot 'System32\cmd.exe'
   $processInfo.Arguments='/d /c npm.cmd run build'
  }
  'database' {
   $processInfo.FileName=(Get-Command docker.exe -CommandType Application -ErrorAction Stop).Source
   $processInfo.Arguments='compose -p ars-windows-pilot --env-file .env.local -f scripts/windows-pilot-compose.yml up -d --wait'
  }
  default { throw 'Unknown installation stage.' }
 }
 $process=[Diagnostics.Process]::Start($processInfo)
 if (-not $process) { throw 'Could not start installation stage.' }
 try {
  $script:stageActivity.Style='Marquee'
  $script:stageActivity.MarqueeAnimationSpeed=30
  $started=[Diagnostics.Stopwatch]::StartNew()
  while (-not $process.WaitForExit(100)) {
   $script:elapsedText.Text=('Working... {0:mm\:ss} elapsed. Do not close Setup.' -f $started.Elapsed)
   [Windows.Forms.Application]::DoEvents()
  }
  if ($process.ExitCode -ne 0) { throw "Installation stage '$stage' failed (exit $($process.ExitCode)). Existing files and data have been retained." }
 } finally {
  $script:stageActivity.Style='Blocks'
  $script:stageActivity.Value=0
  $script:elapsedText.Text=''
  $process.Dispose()
  [Windows.Forms.Application]::DoEvents()
 }
}
