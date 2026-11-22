$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

Write-Host 'Stopping PostgreSQL container...'
docker compose down

Write-Host 'Done. If a dev server is still running in another terminal, stop it with Ctrl+C.'
