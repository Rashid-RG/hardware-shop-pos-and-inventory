# Builds the supervisor in temporary storage and rehearses on disposable data.
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'This rehearsal requires Windows.'
}

$root = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
  throw 'The Windows .NET Framework C# compiler is unavailable.'
}
$node = (Get-Command node.exe -CommandType Application).Source
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\pg\package.json') -PathType Leaf)) {
  throw 'Run npm ci in the test checkout first.'
}

$sources = @(
  'windows-maintenance-job.cs'
  'windows-maintenance-suspended-worker.cs'
  'windows-maintenance-cancellation-bridge.cs'
  'windows-maintenance-supervisor.cs'
) | ForEach-Object { Join-Path $PSScriptRoot $_ }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('ars-recovery-supervisor-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($temp)
try {
  $supervisor = Join-Path $temp 'maintenance-supervisor.exe'
  & $compiler /nologo /target:exe /optimize+ "/out:$supervisor" @sources
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $supervisor -PathType Leaf)) {
    throw 'Maintenance supervisor compilation failed.'
  }
  & $node (Join-Path $PSScriptRoot 'rehearse-windows-docker-maintenance-recovery.mjs') $supervisor
  if ($LASTEXITCODE -ne 0) {
    throw 'The Windows Docker recovery rehearsal failed.'
  }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force
}
