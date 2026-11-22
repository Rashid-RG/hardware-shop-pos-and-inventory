$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

if (-not (Test-Path '.env.local')) {
  Write-Host '.env.local not found. Creating it from .env.example...'
  Copy-Item '.env.example' '.env.local'
  Write-Host '.env.local created. Configure strong passwords and JWT_SECRET before shop use.'
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

# Never silently start with demo login credentials or placeholder session secrets.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not installed or not on PATH. Install Node.js 22 LTS before starting ARS POS.'
}
if (-not (Test-Path 'node_modules')) {
  throw 'Node dependencies are missing. Run npm ci from the project folder first.'
}
$envLines = Get-Content '.env.local'
$jwtLine = $envLines | Where-Object { $_ -match '^\s*JWT_SECRET\s*=' } | Select-Object -First 1
$jwtValue = if ($jwtLine) { (($jwtLine -replace '^\s*JWT_SECRET\s*=\s*', '').Trim().Trim('"').Trim("'")) } else { '' }
if ($jwtValue.Length -lt 32 -or $jwtValue -match '(?i)replace.with|change.?me|example|password') {
  throw 'Set a strong random JWT_SECRET of at least 32 characters in .env.local before starting.'
}
$requiredPasswords = @('ADMIN_PASSWORD', 'MANAGER_PASSWORD', 'WHOLESALE_MANAGER_PASSWORD', 'CASHIER_PASSWORD', 'INVENTORY_PASSWORD')
foreach ($key in $requiredPasswords) {
  $line = $envLines | Where-Object { $_ -match ("^\s*" + $key + "\s*=") } | Select-Object -First 1
  $value = if ($line) { (($line -replace '^\s*[^=]+=\s*', '').Trim().Trim('"').Trim("'")) } else { '' }
  if ($value.Length -lt 12 -or $value -eq 'ChangeMe123!' -or $value -match '(?i)change.?me|example') {
    throw "Configure a unique password of at least 12 characters for $key in .env.local."
  }
}
if (($requiredPasswords | ForEach-Object {
  $key = $_
  $line = $envLines | Where-Object { $_ -match ("^\s*" + $key + "\s*=") } | Select-Object -First 1
  (($line -replace '^\s*[^=]+=\s*', '').Trim().Trim('"').Trim("'"))
} | Select-Object -Unique).Count -ne $requiredPasswords.Count) {
  throw 'Every role must have a different password.'
}

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
  throw "Port 3000 is already in use by PID $portProcess. Close the existing process yourself if appropriate; no process was stopped."
}

# A successful Docker startup does not prove credentials match the configured DB.
$dbUrl = Get-DatabaseUrlFromEnvFile
if (-not (Test-PostgresAuth $dbUrl)) {
  throw 'PostgreSQL authentication failed. Confirm DATABASE_URL credentials and Windows port (Docker Compose default: 5433).'
}
Write-Host 'Database connection verified. Starting application...'
Write-Host 'Open http://localhost:3000 after the server reports ready.'
npm run dev
