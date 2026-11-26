# Read-only identity discovery for the existing ARS Docker database.
param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-runtime-paths.ps1')
$runtime=Get-ArsWindowsRuntimeRoot (Split-Path -Parent $PSScriptRoot)
$config=Join-Path $runtime '.env.local'
$lines=@(Get-Content -LiteralPath $config | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' })
if ($lines.Count -ne 1) { throw 'Exactly one DATABASE_URL is required.' }
try { $uri=[uri](($lines[0] -replace '^\s*DATABASE_URL\s*=\s*','').Trim().Trim('"').Trim("'")) } catch { throw 'Invalid database URL.' }
if ($uri.Scheme -notin @('postgres','postgresql') -or $uri.Host -notin @('localhost','127.0.0.1','::1','[::1]') -or $uri.Port -ne 5433 -or $uri.AbsolutePath -cne '/hardware_pos' -or $uri.Query -or $uri.Fragment) { throw 'Configuration does not match the supported local ARS database.' }
function Read-DockerJson([string[]]$Arguments) {
  $raw=& docker @Arguments 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw 'Docker identity inspection failed.' }
  return (($raw -join "`n") | ConvertFrom-Json)
}
$mutex=New-Object System.Threading.Mutex($false,'Local\ARSDistributorPOSLauncher')
$owns=$false
try {
  try { $owns=$mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owns=$true }
  if (-not $owns) { throw 'Another startup or maintenance operation is active.' }
  $context=& docker context show 2>$null
  if ($LASTEXITCODE -ne 0 -or @($context).Count -ne 1 -or $context -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Unable to identify Docker context.' }
  if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) { throw 'Explicit Docker environment overrides are not supported for identity discovery.' }
  $ctx=@(Read-DockerJson @('context','inspect',$context))
  if ($ctx.Count -ne 1 -or $ctx[0].Endpoints.docker.Host -notmatch '^npipe://') { throw 'Only a local Windows Docker endpoint is supported.' }
  $containers=@(Read-DockerJson @('container','inspect','hardware-pos-postgres'))
  if ($containers.Count -ne 1) { throw 'Expected exactly one existing ARS container.' }
  $c=$containers[0]
  $project=$c.Config.Labels.'com.docker.compose.project'
  if ($c.Name -cne '/hardware-pos-postgres' -or $c.Id -cnotmatch '^[a-f0-9]{64}$' -or $project -cnotmatch '^[a-z0-9][a-z0-9_-]*$' -or $c.Config.Labels.'com.docker.compose.service' -cne 'postgres') { throw 'Container identity does not match ARS Compose service.' }
  $mounts=@($c.Mounts | Where-Object { $_.Destination -ceq '/var/lib/postgresql/data' })
  if ($mounts.Count -ne 1 -or $mounts[0].Type -cne 'volume' -or $mounts[0].Name -cne ($project+'_hardware_pos_pgdata') -or -not $mounts[0].RW) { throw 'Existing PostgreSQL volume binding is not recognized.' }
  $volumes=@(Read-DockerJson @('volume','inspect',$mounts[0].Name))
  if ($volumes.Count -ne 1 -or $volumes[0].Name -cne $mounts[0].Name -or $volumes[0].Driver -cne 'local' -or $volumes[0].Labels.'com.docker.compose.project' -cne $project -or $volumes[0].Labels.'com.docker.compose.volume' -cne 'hardware_pos_pgdata') { throw 'Volume identity does not match existing Compose project.' }
  $ports=@($c.HostConfig.PortBindings.'5432/tcp' | Where-Object { $_.HostPort -eq '5433' })
  if ($ports.Count -lt 1) { throw 'Configured PostgreSQL port binding not found.' }
  if (-not $c.State.Running) { throw 'Existing PostgreSQL container is not running. Identity cannot be verified.' }
  $sql="SELECT system_identifier::text || ':' || (SELECT oid::text FROM pg_database WHERE datname=current_database()) FROM pg_control_system()"
  $inside=@(& docker exec $c.Id psql -X -w -U postgres -d hardware_pos -v ON_ERROR_STOP=1 -Atc $sql 2>$null)
  if ($LASTEXITCODE -ne 0 -or $inside.Count -ne 1 -or $inside[0] -cnotmatch '^[0-9]{1,20}:[0-9]{1,10}$') { throw 'Container PostgreSQL identity query failed.' }
  $outside=@(& node (Join-Path $PSScriptRoot 'probe-postgres-identity.mjs') $config 2>$null)
  if ($LASTEXITCODE -ne 0 -or $outside.Count -ne 1 -or $outside[0] -cne $inside[0]) { throw 'Configured database identity does not match the existing Docker PostgreSQL cluster.' }
  $identity=$inside[0].Split(':')
  $after=@(Read-DockerJson @('container','inspect','hardware-pos-postgres'))
  if ($after.Count -ne 1 -or $after[0].Id -cne $c.Id -or -not $after[0].State.Running -or $after[0].State.StartedAt -cne $c.State.StartedAt) { throw 'Container changed during identity discovery.' }
  [ordered]@{schema=1;context=$context;endpoint=$ctx[0].Endpoints.docker.Host;project=$project;containerId=$c.Id;volume=$volumes[0].Name;database='hardware_pos';port=5433;running=[bool]$c.State.Running;systemIdentifier=$identity[0];databaseOid=$identity[1];activationAllowed=$false;databaseIdentityVerified=$true} | ConvertTo-Json
} finally {
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
