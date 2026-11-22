$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

if (-not (Test-Path '.env.local')) {
  Write-Host '.env.local not found. Creating it from .env.example...'
  Copy-Item '.env.example' '.env.local'
  Write-Host '.env.local created. Update credentials if needed.'
}

function Get-DatabaseUrlFromEnvFile {
  $dbLine = Get-Content '.env.local' | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
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

Write-Host 'Checking Docker daemon...'
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
  Write-Host 'Starting PostgreSQL container...'
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
  Write-Host 'Port 3000 is in use. Stopping existing process...'
  try {
    Stop-Process -Id $portProcess -Force
  } catch {
    Write-Warning 'Failed to stop process on port 3000. Start may fail if port remains occupied.'
  }
}

Write-Host 'Starting application in development mode...'
Start-Process 'http://localhost:3000' | Out-Null
npm run dev
