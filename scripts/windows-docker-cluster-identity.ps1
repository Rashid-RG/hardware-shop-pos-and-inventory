# Read-only identity probe for a fixed local PostgreSQL container.
# No backup, Docker start/stop, credential changes or database mutation.
function ConvertFrom-ArsDockerClusterIdentity([object[]]$lines,[string]$database) {
 if ($database -cnotin @('hardware_pos','hardware_pos_ars') -or $lines.Count -ne 1 -or $lines[0] -isnot [string]) {throw 'Unique managed cluster identity required.'}
 $parts=$lines[0].Split('|')
 if ($parts.Count -ne 3 -or $parts[0] -cne $database -or $parts[1] -cnotmatch '^[1-9][0-9]{0,19}$' -or $parts[2] -cnotmatch '^[1-9][0-9]{0,9}$') {throw 'Invalid Docker cluster identity.'}
 [uint64]$systemId=0
 [uint32]$databaseOid=0
 if (-not [uint64]::TryParse($parts[1],[ref]$systemId) -or -not [uint32]::TryParse($parts[2],[ref]$databaseOid)) {throw 'Invalid Docker cluster identity.'}
 return [pscustomobject]@{database=$database;systemIdentifier=$parts[1];databaseOid=$parts[2]}
}
function Get-ArsDockerClusterIdentity([string]$database) {
 $ErrorActionPreference='Stop'
 if ($database -cnotin @('hardware_pos','hardware_pos_ars')) {throw 'Unsupported managed database.'}
 foreach ($key in @('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')) {
  if ($null -ne [Environment]::GetEnvironmentVariable($key,'Process')) {throw 'Unsupported Docker override.'}
 }
 $endpoint=@(& docker context inspect --format '{{.Endpoints.docker.Host}}')
 if ($LASTEXITCODE -ne 0 -or $endpoint.Count -ne 1 -or $endpoint[0] -cnotin @('npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine')) {throw 'Local Docker required.'}
 $container=if ($database -ceq 'hardware_pos_ars') {'ars-windows-pilot-postgres'} else {'hardware-pos-postgres'}
 $user=if ($database -ceq 'hardware_pos_ars') {'ars'} else {'postgres'}
 $ids=@(& docker inspect --type container --format '{{.Id}}' $container)
 if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1 -or $ids[0] -cnotmatch '^[a-f0-9]{64}$') {throw 'Managed Docker container identity unavailable.'}
 $containerId=$ids[0]
 $sql='SELECT current_database(), system_identifier::text, (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) FROM pg_catalog.pg_control_system()'
 # Do not inherit psql startup files or interactive password prompts.
 # Explicit Unix socket endpoint matches the managed Linux PostgreSQL images.
 $lines=@(& docker exec $containerId psql -X -w -q -A -t -F '|' -v ON_ERROR_STOP=1 -h /var/run/postgresql -p 5432 -U $user -d $database -c $sql)
 if ($LASTEXITCODE -ne 0) {throw 'Docker cluster identity query failed.'}
 $identity=ConvertFrom-ArsDockerClusterIdentity $lines $database
 $current=@(& docker inspect --type container --format '{{.Id}}' $container)
 $currentExit=$LASTEXITCODE
 $currentEndpoint=@(& docker context inspect --format '{{.Endpoints.docker.Host}}')
 if ($LASTEXITCODE -ne 0 -or $currentExit -ne 0 -or $current.Count -ne 1 -or $current[0] -cne $containerId -or $currentEndpoint.Count -ne 1 -or $currentEndpoint[0] -cne $endpoint[0]) {throw 'Docker identity changed during probe.'}
 return [pscustomobject]@{database=$identity.database;systemIdentifier=$identity.systemIdentifier;databaseOid=$identity.databaseOid;containerId=$containerId}
}
