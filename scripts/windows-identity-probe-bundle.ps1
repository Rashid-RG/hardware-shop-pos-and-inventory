# Build and syntax-check the self-contained identity probe using installed dependencies.
function New-ArsIdentityProbeBundle([string]$Source,[string]$Destination) {
  $node=(Get-Command node.exe -CommandType Application).Source
  $esbuild=Join-Path $Source 'node_modules\esbuild\bin\esbuild'
  if (Test-Path -LiteralPath $Destination) { throw 'Probe bundle already exists.' }
  Push-Location -LiteralPath $Source
  try {
    & $node $esbuild 'scripts/probe-postgres-identity.mjs' '--bundle' '--platform=node' '--format=cjs' '--external:pg-native' ("--outfile="+$Destination)
    if ($LASTEXITCODE -ne 0) { throw 'Independent identity probe bundle failed.' }
    & $node --check $Destination
    if ($LASTEXITCODE -ne 0) { throw 'Independent identity probe syntax check failed.' }
  } finally { Pop-Location }
}
