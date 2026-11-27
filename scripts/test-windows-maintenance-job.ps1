$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT') {throw 'Disposable Windows CI runner required.'}
Add-Type -Path @((Join-Path $PSScriptRoot 'windows-maintenance-job.cs'),(Join-Path $PSScriptRoot 'windows-maintenance-suspended-worker.cs'),(Join-Path $PSScriptRoot 'windows-maintenance-cancellation-bridge.cs'))
$nodeCommand=Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
$node=[IO.Path]::GetFullPath([string]$nodeCommand.Path)
if (-not [IO.File]::Exists($node)) {throw 'Native Node executable unavailable.'}
$fixture=Join-Path $env:RUNNER_TEMP ('ars-job-fixture-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixture)
try {
 $marker=Join-Path $fixture 'success.json'
 $code='require("node:fs").writeFileSync(process.argv[1],JSON.stringify(process.argv.slice(2)))'
 [RSNextward.Maintenance.SuspendedWorker]::Run($node,[string[]]@('-e',$code,$marker,'a b','quoted"value','tail\'),$fixture,15000)
 $actual=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
 if ($actual.Count -ne 3 -or $actual[0] -cne 'a b' -or $actual[1] -cne 'quoted"value' -or $actual[2] -cne 'tail\') {throw 'Worker argument round trip failed.'}
 foreach ($case in @('exit','timeout','descendant')) {
  $pidFile=Join-Path $fixture "$case.pid"
  $timeout=15000
  $source=switch ($case) {
   'exit' {'process.exit(7)'}
   'timeout' {$timeout=500;'setInterval(()=>{},1000)'}
   'descendant' {'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",windowsHide:true});require("node:fs").writeFileSync(process.argv[1],String(c.pid));c.unref()'}
  }
  $blocked=$false
  try {[RSNextward.Maintenance.SuspendedWorker]::Run($node,[string[]]@('-e',$source,$pidFile),$fixture,$timeout)} catch {
   $message=$_.Exception.ToString()
   $expected=switch ($case) {'exit' {'Worker failed.'} 'timeout' {'Worker wait failed or timed out.'} 'descendant' {'Worker descendants remain active.'}}
   if (-not $message.Contains($expected)) {throw}
   $blocked=$true
  }
  if (-not $blocked) {throw "Unsafe worker completion: $case"}
  if ($case -eq 'descendant') {
   $childId=[int](Get-Content -LiteralPath $pidFile -Raw)
   $deadline=[DateTime]::UtcNow.AddSeconds(10)
   do {
    $child=Get-Process -Id $childId -ErrorAction SilentlyContinue
    if (-not $child) {break}
    Start-Sleep -Milliseconds 50
   } while ([DateTime]::UtcNow -lt $deadline)
   if ($child) {throw 'Contained descendant survived termination.'}
  }
 }
 $cancelMarker=Join-Path $fixture 'pre-cancelled.txt'
 $cts=New-Object System.Threading.CancellationTokenSource
 try {
  $cts.Cancel()
  $blocked=$false
  try {
   [RSNextward.Maintenance.SuspendedWorker]::Run($node,[string[]]@('-e','require("node:fs").writeFileSync(process.argv[1],"unexpected")',$cancelMarker),$fixture,15000,$cts.Token)
  } catch {
   if (-not ($_.Exception.InnerException -is [OperationCanceledException])) {throw}
   $blocked=$true
  }
  if (-not $blocked -or (Test-Path -LiteralPath $cancelMarker)) {throw 'Pre-cancelled worker executed.'}
 } finally {$cts.Dispose()}
 $activeMarker=Join-Path $fixture 'active-cancel.json'
 $cts=New-Object System.Threading.CancellationTokenSource
 try {
  $source='const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",windowsHide:true});require("node:fs").writeFileSync(process.argv[1],JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)'
  # Cancel from the managed timer while the calling PowerShell thread is blocked.
  $cts.CancelAfter(3000)
  $blocked=$false
  try {
   [RSNextward.Maintenance.SuspendedWorker]::Run($node,[string[]]@('-e',$source,$activeMarker),$fixture,15000,$cts.Token)
  } catch {
   if (-not ($_.Exception.InnerException -is [OperationCanceledException])) {throw}
   $blocked=$true
  }
  if (-not $blocked -or -not (Test-Path -LiteralPath $activeMarker)) {throw 'Active cancellation fixture did not complete its rehearsal.'}
  $ids=Get-Content -LiteralPath $activeMarker -Raw|ConvertFrom-Json
  if ($ids.Count -ne 2) {throw 'Invalid cancellation fixture evidence.'}
  foreach ($workerId in $ids) {
   $deadline=[DateTime]::UtcNow.AddSeconds(10)
   do {
    $remaining=Get-Process -Id ([int]$workerId) -ErrorAction SilentlyContinue
    if (-not $remaining) {break}
    Start-Sleep -Milliseconds 50
   } while ([DateTime]::UtcNow -lt $deadline)
   if ($remaining) {throw ('Cancelled job process remained active. PID: '+$workerId)}
  }
 } finally {$cts.Dispose()}
 # Verify authorization rejection using in-memory private control streams.
 $bridgeMarker=Join-Path $fixture 'bridge-refused.txt'
 foreach ($bytes in @([byte[]]@(),[byte[]]@(88))) {
  $control=New-Object IO.MemoryStream
  try {
   if ($bytes.Length) {$control.Write($bytes,0,$bytes.Length)}
   $control.Position=0
   $blocked=$false
   try {[RSNextward.Maintenance.CancellationBridge]::Run($control,$node,[string[]]@('-e','require("node:fs").writeFileSync(process.argv[1],"unexpected")',$bridgeMarker),$fixture,15000)} catch {
    if (-not $_.Exception.ToString().Contains('Maintenance authorization unavailable.')) {throw}
    $blocked=$true
   }
   if (-not $blocked -or (Test-Path -LiteralPath $bridgeMarker)) {throw 'Unauthorized bridge worker executed.'}
  } finally {$control.Dispose()}
 }
 # Managed fixture supplies a deterministic private stream, with its second
 # read blocked until the worker signals readiness by creating a marker.
 Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Threading;
public sealed class ArsBridgeFixtureStream : Stream {
    private readonly string marker;
    private readonly int revokeByte;
    private int reads;
    public ArsBridgeFixtureStream(string marker, int revokeByte) { this.marker=marker; this.revokeByte=revokeByte; }
    public override int ReadByte() {
        if (Interlocked.Increment(ref reads)==1) return 65;
        for(int i=0;i<400;i++) {
            if(File.Exists(marker)) { if(revokeByte == -2) throw new IOException("fixture disconnect"); return revokeByte; }
            Thread.Sleep(25);
        }
        throw new IOException("fixture readiness timeout");
    }
    public override bool CanRead {get{return true;}}
    public override bool CanSeek {get{return false;}}
    public override bool CanWrite {get{return false;}}
    public override long Length {get{throw new NotSupportedException();}}
    public override long Position {get{throw new NotSupportedException();}set{throw new NotSupportedException();}}
    public override void Flush(){}
    public override int Read(byte[] b,int o,int n){throw new NotSupportedException();}
    public override long Seek(long o,SeekOrigin s){throw new NotSupportedException();}
    public override void SetLength(long l){throw new NotSupportedException();}
    public override void Write(byte[] b,int o,int n){throw new NotSupportedException();}
}
'@
 foreach ($revoke in @(-1,88,-2)) {
  $ready=Join-Path $fixture "bridge-$revoke.json"
  $source='const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",windowsHide:true});const fs=require("node:fs");fs.writeFileSync(process.argv[1]+".tmp",JSON.stringify([process.pid,c.pid]));fs.renameSync(process.argv[1]+".tmp",process.argv[1]);setInterval(()=>{},1000)'
  $control=New-Object ArsBridgeFixtureStream -ArgumentList $ready,$revoke
  try {
   $blocked=$false
   try {[RSNextward.Maintenance.CancellationBridge]::Run($control,$node,[string[]]@('-e',$source,$ready),$fixture,15000)} catch {
    if (-not ($_.Exception.InnerException -is [OperationCanceledException])) {throw}
    $blocked=$true
   }
   if (-not $blocked -or -not (Test-Path -LiteralPath $ready)) {throw 'Bridge revocation rehearsal failed.'}
   $ids=Get-Content -LiteralPath $ready -Raw|ConvertFrom-Json
   if ($ids.Count -ne 2) {throw 'Invalid bridge fixture evidence.'}
   foreach ($workerId in $ids) {
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
   do {
    $remaining=Get-Process -Id ([int]$workerId) -ErrorAction SilentlyContinue
    if (-not $remaining) {break}
    Start-Sleep -Milliseconds 50
   } while ([DateTime]::UtcNow -lt $deadline)
   if ($remaining) {throw ('Revoked bridge job survived. PID: '+$workerId)}
   }
  } finally {$control.Dispose()}
 }
} finally {Remove-Item -LiteralPath $fixture -Recurse -Force}
