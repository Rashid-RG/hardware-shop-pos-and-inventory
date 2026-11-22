$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

Write-Host 'Showing all live collections from app_state (JSONB) ...'

docker exec -i hardware-pos-postgres psql -U postgres -d hardware_pos -c "SELECT jsonb_pretty(state) FROM app_state WHERE id='default';"
