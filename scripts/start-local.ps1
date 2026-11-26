param([switch]$DesktopLaunch)
$ErrorActionPreference = 'Stop'
$launchMutex = $null
$ownsLaunch = $false
try {

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')
if ($DesktopLaunch) {
  $launchMutex = New-Object System.Threading.Mutex($false, 'Local\ARSDistributorPOSLauncher')
  try { $ownsLaunch = $launchMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsLaunch = $true }
  if (-not $ownsLaunch) { return }
}

# Block both desktop and development launcher paths during retained maintenance.
$maintenancePath=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\desktop-control\maintenance.json'
if (Test-Path -LiteralPath $maintenancePath) {
  throw 'ARS is in retained maintenance mode. Do not restart until recovery or update preparation has been reviewed.'
}

# Resolve external configuration explicitly, but keep external startup gated until
# the existing Docker volume identity and activation protocol are verified.
. (Join-Path $scriptDir 'windows-runtime-paths.ps1')
$runtimeRoot=Get-ArsWindowsRuntimeRoot (Get-Location).Path
$configPath=Join-Path $runtimeRoot '.env.local'
$externalRuntime=$null -ne [Environment]::GetEnvironmentVariable('ARS_RUNTIME_ROOT','Process')
if ($externalRuntime) {
  throw 'External runtime startup is disabled until stable database binding and activation are verified.'
}
if (-not (Test-Path '.env.local')) {
  Write-Host '.env.local not found. Creating it from .env.example...'
  Copy-Item '.env.example' '.env.local'
  Write-Host '.env.local created. Configure JWT_SECRET before shop use. Create administrator through first-time setup.'
}

function Get-DatabaseUrlFromEnvFile {
  $dbLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
  if (-not $dbLine) {
    return ''
  }

  return (($dbLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim())
}

function Test-DockerDaemon {
  $previousNativePreference = $null
  $hasNativePreference = $false

  if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $hasNativePreference = $true
    $previousNativePreference = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
  }

  try {
    docker info *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    if ($hasNativePreference) {
      $PSNativeCommandUseErrorActionPreference = $previousNativePreference
    }
  }
}

function Start-DockerDesktopIfAvailable {
  $dockerDesktopPaths = @(
    'C:\Program Files\Docker\Docker\Docker Desktop.exe',
    'C:\Program Files\Docker\Docker\Docker Desktop',
    "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
  )

  foreach ($path in $dockerDesktopPaths) {
    if (Test-Path $path) {
      Write-Host 'Starting Docker Desktop...'
      Start-Process -FilePath $path | Out-Null
      return $true
    }
  }

  return $false
}

function Wait-ForDockerCompose([int]$timeoutSeconds = 180) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Try-StartDockerCompose) {
      return $true
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Try-StartDockerCompose {
  if ($externalRuntime) { throw 'Release-relative Docker startup is prohibited with external runtime.' }
  try {
    cmd /c "docker compose up -d" *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Test-PostgresAuth([string]$connectionString) {
  $previousDbUrl = $env:DATABASE_URL
  $env:DATABASE_URL = $connectionString
  $previousNativePreference = $null
  $hasNativePreference = $false

  if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $hasNativePreference = $true
    $previousNativePreference = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
  }

  try {
    node -e "const { Client } = require('pg'); (async () => { const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect(); await client.end(); })().catch(() => { process.exit(1); });" *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    $env:DATABASE_URL = $previousDbUrl
    if ($hasNativePreference) {
      $PSNativeCommandUseErrorActionPreference = $previousNativePreference
    }
  }
}

# Never silently start with demo login credentials or placeholder session secrets.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not installed or not on PATH. Install Node.js 22 LTS before starting ARS POS.'
}
if (-not (Test-Path 'node_modules')) {
  throw 'Node dependencies are missing. Run npm ci from the project folder first.'
}
$envLines = Get-Content -LiteralPath $configPath
$jwtLine = $envLines | Where-Object { $_ -match '^\s*JWT_SECRET\s*=' } | Select-Object -First 1
$jwtValue = if ($jwtLine) { (($jwtLine -replace '^\s*JWT_SECRET\s*=\s*', '').Trim().Trim('"').Trim("'")) } else { '' }
if ($jwtValue.Length -lt 32 -or $jwtValue -match '(?i)replace.with|change.?me|example|password') {
  throw 'Set a strong random JWT_SECRET of at least 32 characters in .env.local before starting.'
}
Write-Host 'Employee credentials are managed in PostgreSQL; no role passwords are required in .env.local.'

Write-Host 'Checking database configuration...'
$dockerAvailable = $false

$dbUrl = Get-DatabaseUrlFromEnvFile
$dbReady = $false
if ($dbUrl) {
  try {
    $uri = [System.Uri]$dbUrl
    $dbHost = if ($uri.Host) { $uri.Host } else { '127.0.0.1' }
    $dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }

    if (Test-NetConnection -ComputerName $dbHost -Port $dbPort -InformationLevel Quiet -WarningAction SilentlyContinue) {
      if (Test-PostgresAuth $dbUrl) {
        $dbReady = $true
        $dockerAvailable = $false
        Write-Host "PostgreSQL is already reachable at ${dbHost}:${dbPort}. Skipping Docker startup..."
      }
    }
  } catch {
    $dbReady = $false
  }
}

if (-not $dbReady) {
  if (-not $dbUrl) {
    throw 'DATABASE_URL is missing in .env.local.'
  }
  try {
    $parsedUrl = [System.Uri]$dbUrl
    $dbHost = $parsedUrl.Host
  } catch {
    throw 'DATABASE_URL in .env.local is invalid.'
  }
  if ($dbHost -notin @('localhost', '127.0.0.1', '::1', '[::1]')) {
    throw 'Configured remote PostgreSQL is not reachable. Refusing to start unrelated local Docker database.'
  }
  Write-Host 'Starting local PostgreSQL container...'
  if (Try-StartDockerCompose) {
    $dockerAvailable = $true
  } else {
    Write-Warning 'Docker daemon is not running.'

    $dockerStarted = Start-DockerDesktopIfAvailable
    if ($dockerStarted) {
      Write-Host 'Waiting for Docker Desktop and postgres container to become ready...'
      if (Wait-ForDockerCompose) {
        $dockerAvailable = $true
      } else {
        Write-Warning 'Docker Desktop did not become ready in time.'
      }
    }
  }
}

if (-not $dockerAvailable -and -not $dbReady) {
  if (-not $dbUrl) {
    Write-Error 'DATABASE_URL is missing in .env.local. Start Docker Desktop or point DATABASE_URL to a running PostgreSQL instance.'
    exit 1
  }

  try {
    $uri = [System.Uri]$dbUrl
    $dbHost = if ($uri.Host) { $uri.Host } else { '127.0.0.1' }
    $dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
  } catch {
    Write-Error 'DATABASE_URL in .env.local is invalid. Start Docker Desktop or fix DATABASE_URL.'
    exit 1
  }

  $dbReachable = Test-NetConnection -ComputerName $dbHost -Port $dbPort -InformationLevel Quiet -WarningAction SilentlyContinue
  if (-not $dbReachable) {
    Write-Error "PostgreSQL is not reachable at ${dbHost}:${dbPort}. Start Docker Desktop or start PostgreSQL manually, then re-run npm run local:start."
    exit 1
  }

  if (-not (Test-PostgresAuth $dbUrl)) {
    if (Try-StartDockerCompose) {
      Write-Host 'Docker postgres became available after fallback check. Continuing...'
    } else {
      Write-Error "PostgreSQL is reachable but DATABASE_URL authentication failed (invalid user/password or DB). Update DATABASE_URL in .env.local or start the Docker postgres container with expected credentials."
      exit 1
    }
  } else {
    Write-Host "Docker unavailable, but PostgreSQL is reachable at ${dbHost}:${dbPort}. Continuing without docker compose..."
  }
}

$portProcess = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty OwningProcess

if ($portProcess) {
  if ($DesktopLaunch) {
    try {
      $ready = Invoke-RestMethod 'http://localhost:3000/api/ready' -TimeoutSec 3
      if ($ready.ok -eq $true -and $ready.status -eq 'ready' -and $ready.database -eq 'reachable' -and $ready.sourceOfTruth -eq 'normalized') {
        Start-Process 'http://localhost:3000'
        return
      }
    } catch { }
  }
  throw "Port 3000 is already in use by PID $portProcess. Close the existing process yourself if appropriate; no process was stopped."
}

# A successful Docker startup does not prove credentials match the configured DB.
$dbUrl = Get-DatabaseUrlFromEnvFile
if (-not (Test-PostgresAuth $dbUrl)) {
  throw 'PostgreSQL authentication failed. Confirm DATABASE_URL credentials and Windows port (Docker Compose default: 5433).'
}
Write-Host 'Database connection verified. Starting application...'
Write-Host 'Open http://localhost:3000 after the server reports ready.'
if ($DesktopLaunch) {
  # Desktop business use runs only a prepared production build, never a development server.
  if (-not (Test-Path 'dist/server.cjs' -PathType Leaf) -or -not (Test-Path 'dist/index.html' -PathType Leaf)) {
    throw 'Production build is missing. Run npm run build during approved installation or update preparation.'
  }
  $env:NODE_ENV = 'production'
  $env:ARS_LISTEN_HOST = '127.0.0.1'
  $env:PORT = '3000'
  $env:CORS_ALLOWED_ORIGINS = 'http://localhost:3000'
  $controlDir=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\desktop-control'
  New-Item -ItemType Directory -Path $controlDir -Force | Out-Null
  if ((Get-Item -LiteralPath $controlDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected desktop control directory.' }
  $recordPath=Join-Path $controlDir 'instance.json'
  if (Test-Path -LiteralPath $recordPath) { throw 'Previous desktop control record exists. Verify previous shutdown with RS Nextward support before restarting.' }
  $pipeName='ars-pos-'+[guid]::NewGuid().ToString('N')
  $bytes=New-Object byte[] 32
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $secret=[BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
  # DPAPI protects the stored token for the current Windows account.
  $secure=ConvertTo-SecureString $secret -AsPlainText -Force
  $encrypted=ConvertFrom-SecureString $secure
  $env:ARS_DESKTOP_SHUTDOWN_PIPE='\\.\pipe\'+$pipeName
  $env:ARS_DESKTOP_SHUTDOWN_SECRET=$secret
  try {
  $process = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'dist/server.cjs' -WindowStyle Hidden -PassThru
  } finally {
    Remove-Item Env:ARS_DESKTOP_SHUTDOWN_PIPE -ErrorAction SilentlyContinue
    Remove-Item Env:ARS_DESKTOP_SHUTDOWN_SECRET -ErrorAction SilentlyContinue
  }
  $record=[ordered]@{schema=1;project=(Get-Location).Path;pid=$process.Id;startedUtc=$process.StartTime.ToUniversalTime().Ticks.ToString();pipe=$pipeName;protectedSecret=$encrypted}
  $stream=[IO.File]::Open($recordPath,[IO.FileMode]::CreateNew)
  try {
    $encoded=[Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json))
    $stream.Write($encoded,0,$encoded.Length)
  } finally { $stream.Dispose() }

  $deadline = (Get-Date).AddSeconds(150)
  while ((Get-Date) -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) { throw 'ARS application exited before it became ready. Contact RS Nextward support.' }
    try {
      $ready = Invoke-RestMethod 'http://localhost:3000/api/ready' -TimeoutSec 2
      if ($ready.ok -eq $true -and $ready.status -eq 'ready' -and $ready.database -eq 'reachable' -and $ready.sourceOfTruth -eq 'normalized') {
        Start-Process 'http://localhost:3000'
        return
      }
    } catch { }
    Start-Sleep -Seconds 1
  }
  throw 'ARS could not confirm readiness. The application may still be starting; no process was stopped. Contact support if the problem persists.'
} else {
  npm run dev
}
} catch {
  if ($DesktopLaunch) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'ARS Distributor POS', 'OK', 'Error')
    exit 1
  }
  throw
} finally {
  if ($ownsLaunch -and $launchMutex) { $launchMutex.ReleaseMutex() }
  if ($launchMutex) { $launchMutex.Dispose() }
}
