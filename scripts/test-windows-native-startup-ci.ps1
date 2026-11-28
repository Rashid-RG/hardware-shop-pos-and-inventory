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
 # A private maintenance location is required by the ordinary startup guard.
 $privateLocal=Join-Path $root 'local-app-data'
 New-Item -ItemType Directory -Path $privateLocal -ErrorAction Stop | Out-Null
 $info.EnvironmentVariables['LOCALAPPDATA']=$privateLocal
 $info.EnvironmentVariables['APPDATA']=$privateLocal
 $info.EnvironmentVariables['NODE_ENV']='production'
 $info.EnvironmentVariables['DATABASE_URL']='postgresql://restore_admin@127.0.0.1:55433/ars_native_ci'
 $info.EnvironmentVariables['PORT']='30123'
 $info.EnvironmentVariables['ARS_LISTEN_HOST']='127.0.0.1'
 $info.EnvironmentVariables['JWT_SECRET']=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
 $release=(Get-Content -LiteralPath (Join-Path $build 'package.json') -Raw | ConvertFrom-Json).version
 $verifier=Join-Path $PSScriptRoot 'verify-installed-release-readiness.mjs'
 function Start-NativeApplication {
  $child=[Diagnostics.Process]::Start($info)
  $out=$child.StandardOutput.ReadToEndAsync()
  $err=$child.StandardError.ReadToEndAsync()
  try {
   for ($i=0;$i -lt 90;$i++) {
    if ($child.HasExited) { throw ('Native server exited: '+$err.GetAwaiter().GetResult()) }
    $ErrorActionPreference='Continue'
    $PSNativeCommandUseErrorActionPreference=$false
    & $node $verifier $release $child.Id '30123' *> $null
    if ($LASTEXITCODE -eq 0 -and -not $child.HasExited) { return $child }
    Start-Sleep -Seconds 1
   }
   throw 'Native application readiness not confirmed.'
  } catch {
   if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
   $child.Dispose()
   throw
  }
 }
 function Stop-NativeApplication($child) {
  if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
  $child.Dispose()
 }
 $process=Start-NativeApplication
 $page=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:30123/' -TimeoutSec 10
 if ($page.StatusCode -ne 200 -or $page.Content -notmatch '<html') { throw 'Native frontend unavailable.' }
 # Populate the fresh synthetic database with historical business fixtures.
 $sqlFile=Join-Path $root 'historical.sql'
 @'
INSERT INTO products(id,shop_id,name,sku,brand,category,cost_price,selling_price,quantity,reorder_level,warranty,description)
VALUES('native-history-product','shop-main','Synthetic historical pipe','NATIVE-HISTORY-01','ARS','Hardware',50,100,8,2,'None','CI fixture');
INSERT INTO customers(id,shop_id,name,loyalty_balance,purchase_count,credit_limit,credit_balance)
VALUES('native-history-customer','shop-main','Synthetic historical customer',0,0,10000,0);
'@ | Set-Content -LiteralPath $sqlFile -Encoding ASCII
 Invoke-NativeChecked (Join-Path $PostgresBin 'psql.exe') @('-X','-h','127.0.0.1','-p','55433','-U','restore_admin','-d','ars_native_ci','-v','ON_ERROR_STOP=1','-f',$sqlFile)
 Stop-NativeApplication $process
 $process=$null
 function Get-HistoricalRows([string]$database) {
  $query="SELECT row_to_json(p)::text FROM products p WHERE id='native-history-product'; SELECT row_to_json(c)::text FROM customers c WHERE id='native-history-customer';"
  $rows=@(& (Join-Path $PostgresBin 'psql.exe') -X -h 127.0.0.1 -p 55433 -U restore_admin -d $database -v ON_ERROR_STOP=1 -Atc $query)
  if ($LASTEXITCODE -ne 0 -or $rows.Count -ne 2) { throw 'Historical fixture missing.' }
  $rows -join [Environment]::NewLine
 }
 $historical=Get-HistoricalRows 'ars_native_ci'
 $archive=Join-Path $root 'native-history.dump'
 Invoke-NativeChecked (Join-Path $PostgresBin 'pg_dump.exe') @('-h','127.0.0.1','-p','55433','-U','restore_admin','-d','ars_native_ci','-Fc','-f',$archive)
 $archiveHash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
 Invoke-NativeChecked (Join-Path $PostgresBin 'createdb.exe') @('-h','127.0.0.1','-p','55433','-U','restore_admin','ars_native_restored_ci')
 Invoke-NativeChecked (Join-Path $PostgresBin 'pg_restore.exe') @('-h','127.0.0.1','-p','55433','-U','restore_admin','-d','ars_native_restored_ci','--single-transaction','--exit-on-error','--no-owner','--no-acl',$archive)
 if ((Get-HistoricalRows 'ars_native_restored_ci') -cne $historical) { throw 'Restored historical rows differ.' }
 $info.EnvironmentVariables['DATABASE_URL']='postgresql://restore_admin@127.0.0.1:55433/ars_native_restored_ci'
 $process=Start-NativeApplication
 if ((Get-HistoricalRows 'ars_native_restored_ci') -cne $historical -or (Get-HistoricalRows 'ars_native_ci') -cne $historical -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $archiveHash) { throw 'Historical fixture or archive changed during restored startup.' }
 Write-Host 'Native Windows restored database startup and historical preservation passed.'
 # Seed a synthetic administrator exclusively in the restored database.
 # Authentication loads users at application startup; stop before inserting the fixture.
 Stop-NativeApplication $process
 $process=$null
 $testEmail='native-'+[guid]::NewGuid().ToString('N')+'@example.invalid'
 $testId='native-'+[guid]::NewGuid().ToString('N')
 $testPassword=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
 Push-Location -LiteralPath $build
 try {
  $hash=@(& $node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" $testPassword)
  if ($LASTEXITCODE -ne 0 -or $hash.Count -ne 1 -or $hash[0] -cnotmatch '^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$') { throw 'Synthetic password hash failed.' }
 } finally { Pop-Location }
 $sql="INSERT INTO users(id,email,name,role,password_hash) VALUES ('$testId','$testEmail','Native CI Administrator','Super Admin','"+$hash[0]+"');"
 Invoke-NativeChecked (Join-Path $PostgresBin 'psql.exe') @('-X','-h','127.0.0.1','-p','55433','-U','restore_admin','-d','ars_native_restored_ci','-v','ON_ERROR_STOP=1','-c',$sql)
 # Reload the persisted synthetic user through ordinary production startup.
 $process=Start-NativeApplication
 # Run the trusted CI-only probe using the same clean environment and native runtime.
 $probe=Join-Path $build 'native-restored-probe.mjs'
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-native-restored-probe.mjs') -Destination $probe
 $info.Arguments='native-restored-probe.mjs'
 $info.EnvironmentVariables['ARS_NATIVE_CI']='disposable-windows-runner'
 $info.EnvironmentVariables['ARS_TEST_EMAIL']=$testEmail
 $info.EnvironmentVariables['ARS_TEST_PASSWORD']=$testPassword
 $client=[Diagnostics.Process]::Start($info)
 try {
  $clientOut=$client.StandardOutput.ReadToEndAsync()
  $clientErr=$client.StandardError.ReadToEndAsync()
  if (-not $client.WaitForExit(180000)) { $client.Kill(); $client.WaitForExit(); throw 'Native transaction probe timed out.' }
  if ($client.ExitCode -ne 0) { throw ('Native transaction probe failed: '+$clientErr.GetAwaiter().GetResult()) }
  Write-Host $clientOut.GetAwaiter().GetResult()
 } finally { $client.Dispose() }
 if ((Get-HistoricalRows 'ars_native_restored_ci') -cne $historical -or (Get-HistoricalRows 'ars_native_ci') -cne $historical -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $archiveHash) { throw 'Historical fixture or archive changed during transaction probe.' }

 # Only the synthetic runner database is inspected. No shop backup is used.
 Invoke-NativeChecked (Join-Path $PostgresBin 'psql.exe') @('-X','-h','127.0.0.1','-p','55433','-U','restore_admin','-d','ars_native_restored_ci','-v','ON_ERROR_STOP=1','-c','SELECT count(*) FROM products; SELECT count(*) FROM customers; SELECT count(*) FROM sales_transactions;')
 if ((Get-ArsPreparedFingerprint (Join-Path $build 'dist')).digest -cne (Get-ArsPreparedFingerprint (Join-Path $Project 'dist')).digest) { throw 'Native executable changed.' }
 Write-Host "Native Windows production build startup and frontend verified; initial tree fingerprint: $fingerprint"
} finally {
 if ($process) {
  if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
  $process.Dispose()
 }
 if ($started) { Invoke-NativeChecked (Join-Path $PostgresBin 'pg_ctl.exe') @('-D',$cluster,'-m','fast','-w','stop') }
}
