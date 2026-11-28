# Execute the bundled probe outside the application tree on a disposable Windows CI runner.
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable hosted runner required.' }
. (Join-Path $PSScriptRoot 'windows-identity-probe-bundle.ps1')
$root=Split-Path -Parent $PSScriptRoot
$work=Join-Path $env:RUNNER_TEMP ('ars-probe-'+[guid]::NewGuid().ToString('N'))
$node=(Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$previousNodePath=$env:NODE_PATH
try {
  New-Item -ItemType Directory -Path $work | Out-Null
  $bundle=Join-Path $work 'probe.cjs'
  New-ArsIdentityProbeBundle $root $bundle
  $env:NODE_PATH=''
  $config=Join-Path $work 'invalid.env'
  # Invalid endpoint must be rejected before any database connection.
  [IO.File]::WriteAllText($config,'DATABASE_URL=postgresql://test:ci-only@127.0.0.1:1/hardware_pos')
  Push-Location -LiteralPath $work
  try {
    # Use the native process object directly; Start-Process -PassThru
    # can race a short-lived child on Windows PowerShell 5.1.
    $info=New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName=$node
    $info.Arguments='"' + $bundle + '" "' + $config + '"'
    $info.WorkingDirectory=$work
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true
    $info.RedirectStandardError=$true
    $p=New-Object System.Diagnostics.Process
    $p.StartInfo=$info
    try {
      if (-not $p.Start()) { throw 'Probe process did not start.' }
      $stdout=$p.StandardOutput.ReadToEndAsync()
      $stderr=$p.StandardError.ReadToEndAsync()
      if (-not $p.WaitForExit(15000)) {
        $p.Kill()
        $p.WaitForExit()
        throw 'Probe process timed out.'
      }
      $p.WaitForExit()
      $exitCode=$p.ExitCode
      $output=$stdout.GetAwaiter().GetResult()
      $message=$stderr.GetAwaiter().GetResult().Trim()
    } finally { $p.Dispose() }
    if ($exitCode -ne 1) { throw 'Invalid endpoint was not rejected.' }
    if ($output.Length -ne 0) { throw 'Unexpected probe stdout.' }
    if ($message -cne 'PostgreSQL identity verification failed.') { throw 'Bundled probe did not reach controlled failure path.' }
  } finally { Pop-Location }
  Write-Host 'Independent bundled probe executed and rejected invalid configuration without exposing credentials.'
} finally {
  $env:NODE_PATH=$previousNodePath
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
