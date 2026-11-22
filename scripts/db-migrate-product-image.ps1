$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

$migrationPath = 'migrations/003_add_product_image_column.sql'
if (-not (Test-Path $migrationPath)) {
  Write-Error "Migration file not found: $migrationPath"
  exit 1
}

Write-Host 'Applying product image column migration...'
Get-Content $migrationPath | docker exec -i hardware-pos-postgres psql -U postgres -d hardware_pos
Write-Host 'Migration applied.'
