$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

Write-Host 'Listing tables in hardware_pos...'
docker exec -i hardware-pos-postgres psql -U postgres -d hardware_pos -c "\dt"
