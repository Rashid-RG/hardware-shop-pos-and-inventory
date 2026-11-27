# Native production-server smoke test on a disposable GitHub Windows runner only.
param([Parameter(Mandatory=$true)][string]$Project,[Parameter(Mandatory=$true)][string]$PostgresBin)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows') { throw 'Disposable Windows CI only.' }
. (Join-Path $PSScriptRoot 'windows-prepared-fingerprint.ps1')
$node=(Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$root=Join-Path $env:RUNNER_TEMP ('ars-native-smoke-'+[guid]::NewGuid().ToString('N'))
$build=Join-Path $root 'app'
New-Item -ItemType Directory -Path $build -Force | Out-Null
$process=$null
$cluster=Join-Path $root 'pg'
$started=$false
function Invoke-NativeChecked([string]$program,[string[]]$arguments) {
 & $program @arguments
 if ($LASTEXITCODE -ne 0) { throw 'Native smoke command failed.' }
}
try {
 foreach ($name in @('dist','node_modules','package.json','package-lock.json')) {
  Copy-Item -LiteralPath (Join-Path $Project $name) -Destination (Join-Path $build $name) -Recurse
 }
 $fingerprint=(Get-ArsPreparedFingerprint $build).digest
 # Separate native PostgreSQL cluster; never reuse the existing CI database.
 if (Get-NetTCPConnection -LocalPort 55433 -State Listen -ErrorAction SilentlyContinue) { throw 'Disposable PostgreSQL port occupied.' }
 if (Get-NetTCPConnection -LocalPort 30123 -State Listen -ErrorAction SilentlyContinue) { throw 'Disposable application port occupied.' }
 Invoke-NativeChecked (Join-Path $PostgresBin 'initdb.exe') @('-D',$cluster,'-U','restore_admin','-A','trust','-E','UTF8','--locale=C')
 Invoke-NativeChecked (Join-Path $PostgresBin 'pg_ctl.exe') @('-D',$cluster,'-l',(Join-Path $root 'pg.log'),'-o','-h 127.0.0.1 -p 55433','-w','start')
 $started=$true
 Invoke-NativeChecked (Join-Path $PostgresBin 'createdb.exe') @('-h','127.0.0.1','-p','55433','-U','restore_admin','ars_native_ci')
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$node
 $info.WorkingDirectory=$build
 $info.Arguments='dist/server.cjs'
 $info.UseShellExecute=$false
 $info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true
 $info.RedirectStandardError=$true
 $info.EnvironmentVariables.Clear()
 foreach ($key in @('SystemRoot','WINDIR','SystemDrive')) {
  $value=[Environment]::GetEnvironmentVariable($key)
  if ($value) { $info.EnvironmentVariables[$key]=$value }
 }
 $info.EnvironmentVariables['PATH']=Join-Path $env:SystemRoot 'System32'
 foreach ($key in @('TEMP','TMP','USERPROFILE','HOME')) { $info.EnvironmentVariables[$key]=$root }
 $info.EnvironmentVariables['NODE_ENV']='production'
 $info.EnvironmentVariables['DATABASE_URL']='postgresql://restore_admin@127.0.0.1:55433/ars_native_ci'
 $info.EnvironmentVariables['PORT']='30123'
 $info.EnvironmentVariables['ARS_LISTEN_HOST']='127.0.0.1'
 $info.EnvironmentVariables['JWT_SECRET']=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
 $process=[Diagnostics.Process]::Start($info)
 $stdout=$process.StandardOutput.ReadToEndAsync()
 $stderr=$process.StandardError.ReadToEndAsync()
 $ready=$false
 for ($i=0;$i -lt 90;$i++) {
  if ($process.HasExited) { throw ('Native server exited: '+$stderr.GetAwaiter().GetResult()) }
  try {
   $response=Invoke-RestMethod -Uri 'http://127.0.0.1:30123/api/ready' -TimeoutSec 2
   if ($response.ok -eq $true -and $response.status -eq 'ready' -and $response.database -eq 'reachable' -and $response.sourceOfTruth -eq 'normalized') { $ready=$true; break }
  } catch {}
  Start-Sleep -Seconds 1
 }
 if (-not $ready) { throw 'Native application readiness not confirmed.' }
 $page=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:30123/' -TimeoutSec 10
 if ($page.StatusCode -ne 200 -or $page.Content -notmatch '<html') { throw 'Native frontend unavailable.' }
 # Only the synthetic runner database is inspected. No shop backup is used.
 Invoke-NativeChecked (Join-Path $PostgresBin 'psql.exe') @('-X','-h','127.0.0.1','-p','55433','-U','restore_admin','-d','ars_native_ci','-v','ON_ERROR_STOP=1','-c','SELECT count(*) FROM products; SELECT count(*) FROM customers; SELECT count(*) FROM sales_transactions;')
 if ((Get-ArsPreparedFingerprint (Join-Path $build 'dist')).digest -cne (Get-ArsPreparedFingerprint (Join-Path $Project 'dist')).digest) { throw 'Native executable changed.' }
 Write-Host "Native Windows production build startup and frontend verified; initial tree fingerprint: $fingerprint"
} finally {
 if ($process) {
  if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
  $process.Dispose()
 }
 if ($started) { Invoke-NativeChecked (Join-Path $PostgresBin 'pg_ctl.exe') @('-D',$cluster,'-m','fast','-w','stop') }
}
