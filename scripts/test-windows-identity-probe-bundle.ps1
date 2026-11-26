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
    $p=Start-Process -FilePath $node -ArgumentList @('"' + $bundle + '"','"' + $config + '"') -RedirectStandardOutput (Join-Path $work 'stdout.txt') -RedirectStandardError (Join-Path $work 'stderr.txt') -PassThru -NoNewWindow -Wait
    if ($p.ExitCode -ne 1) { throw 'Invalid endpoint was not rejected.' }
    if ((Get-Item -LiteralPath (Join-Path $work 'stdout.txt')).Length -ne 0) { throw 'Unexpected probe stdout.' }
    $message=(Get-Content -LiteralPath (Join-Path $work 'stderr.txt') -Raw).Trim()
    if ($message -cne 'PostgreSQL identity verification failed.') { throw 'Bundled probe did not reach controlled failure path.' }
  } finally { Pop-Location }
  Write-Host 'Independent bundled probe executed and rejected invalid configuration without exposing credentials.'
} finally {
  $env:NODE_PATH=$previousNodePath
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
