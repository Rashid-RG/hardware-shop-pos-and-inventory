# Native Windows acceptance checks on a disposable GitHub-hosted runner.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This check requires a disposable GitHub-hosted Windows runner.'
}
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program exited with $LASTEXITCODE" }
}
Get-ChildItem -Path scripts -Recurse -Filter '*.ps1' | ForEach-Object {
  $parseErrors = $null
  $tokens = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors) { throw "$($_.Name): $($parseErrors.Message)" }
}
& (Join-Path $PSScriptRoot 'test-windows-prepared-fingerprint.ps1')
& (Join-Path $PSScriptRoot 'test-windows-identity-probe-bundle.ps1')
& (Join-Path $PSScriptRoot 'test-windows-setup-destination.ps1')
& (Join-Path $PSScriptRoot 'test-windows-prepare-repair.ps1')
& (Join-Path $PSScriptRoot 'test-windows-repair-backup-review.ps1')
& (Join-Path $PSScriptRoot 'test-windows-repair-readiness.ps1')
& (Join-Path $PSScriptRoot 'test-windows-repair-native-probe.ps1')
$postgresRoot = Join-Path $env:ProgramFiles 'PostgreSQL'
$bin = Get-ChildItem $postgresRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin/initdb.exe') } |
  Sort-Object { [int]$_.Name } -Descending | Select-Object -First 1
if (-not $bin) { throw 'PostgreSQL tools are missing on the Windows runner.' }
$env:Path = "$(Join-Path $bin.FullName 'bin');$env:Path"
$cluster = Join-Path $env:RUNNER_TEMP ("ars-postgres-" + [guid]::NewGuid())
$log = "$cluster.log"
Invoke-Checked 'initdb' @('-D', $cluster, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C')
Invoke-Checked 'pg_ctl' @('-D', $cluster, '-l', $log, '-o', '-h 127.0.0.1 -p 55432', '-w', 'start')
try {
  Invoke-Checked 'createdb' @('-h','127.0.0.1','-p','55432','-U','postgres','hardware_pos_ci')
  $env:DATABASE_URL = 'postgresql://postgres@127.0.0.1:55432/hardware_pos_ci'
  $env:JWT_SECRET = 'ci-only-disposable-windows-session-secret'
  Invoke-Checked 'node' @('--import','tsx','--test','--test-concurrency=1',
    'tests/postgres-checkout.integration.mjs','tests/postgres-credit.integration.mjs',
    'tests/postgres-purchases.integration.mjs','tests/postgres-product-intake.integration.mjs')
} finally {
  Invoke-Checked 'pg_ctl' @('-D',$cluster,'-m','fast','-w','stop')
}
& (Join-Path $PSScriptRoot 'test-windows-native-startup-ci.ps1') -Project (Split-Path -Parent $PSScriptRoot) -PostgresBin (Join-Path $bin.FullName 'bin')
