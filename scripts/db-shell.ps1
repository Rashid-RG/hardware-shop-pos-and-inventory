$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

Write-Host 'Opening PostgreSQL shell inside container...'
docker exec -it hardware-pos-postgres psql -U postgres -d hardware_pos
