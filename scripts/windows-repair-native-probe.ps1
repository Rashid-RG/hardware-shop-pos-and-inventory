# Read-only native Node probe. Syntax-checks container-tested server bytes, never starts them.
function Invoke-ArsNativeNodeProbe([string]$node,[string]$directory,[string]$arguments) {
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$node
 $info.WorkingDirectory=$directory
 $info.Arguments=$arguments
 $info.UseShellExecute=$false
 $info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true
 $info.RedirectStandardError=$true
 $info.EnvironmentVariables.Clear()
 foreach ($key in @('SystemRoot','WINDIR','SystemDrive')) {
  $value=[Environment]::GetEnvironmentVariable($key)
  if ($value) { $info.EnvironmentVariables[$key]=$value }
 }
 $info.EnvironmentVariables['TEMP']=$directory
 $info.EnvironmentVariables['TMP']=$directory
 $info.EnvironmentVariables['USERPROFILE']=$directory
 $info.EnvironmentVariables['PATH']=Join-Path $env:SystemRoot 'System32'
 $process=[Diagnostics.Process]::Start($info)
 try {
  $stdout=$process.StandardOutput.ReadToEndAsync()
  $stderr=$process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(30000)) { $process.Kill(); $process.WaitForExit(); throw 'Node runtime probe timed out.' }
  if ($process.ExitCode -ne 0) { throw 'Node runtime probe failed.' }
  $stdout.GetAwaiter().GetResult().Trim()
 } finally { $process.Dispose() }
}
function Assert-ArsNativeNodeIdentity($identity) {
 if ($identity.platform -cne 'win32' -or $identity.arch -cne 'x64' -or $identity.version -cnotmatch '^22\.(\d+)\.\d+$' -or [int]$Matches[1] -lt 12 -or $identity.abi -cnotmatch '^\d+$') { throw 'Native Windows x64 Node 22.12+ required.' }
}
function Get-ArsNativeRepairProbe([string]$image) {
 if ($image -cnotmatch '^sha256:[a-f0-9]{64}$') { throw 'Exact tested image required.' }
 $command=Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
 $node=$command.Source
 Assert-ArsPlainPath $node
 $before=(Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash
 $directory=Join-Path ([IO.Path]::GetTempPath()) ('ars-native-probe-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null
 $container=$null
 try {
  $identity=Invoke-ArsNativeNodeProbe $node $directory '-p "JSON.stringify({version:process.versions.node,abi:process.versions.modules,platform:process.platform,arch:process.arch})"' | ConvertFrom-Json
  Assert-ArsNativeNodeIdentity $identity
  # Create a stopped, disconnected container solely to copy server bytes.
  $name='ars-native-probe-'+[guid]::NewGuid().ToString('N')
  $created=@(& docker create --pull=never --network none --name $name --entrypoint node $image --version)
  if ($LASTEXITCODE -ne 0 -or $created.Count -ne 1 -or $created[0] -cnotmatch '^[a-f0-9]{64}$') { throw 'Could not create isolated inspection container.' }
  $container=$created[0]
  $file=Join-Path $directory 'server.cjs'
  & docker cp ($container+':/app/dist/server.cjs') $file | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not extract tested server bytes.' }
  Assert-ArsPlainPath $file
  $serverHash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  $null=Invoke-ArsNativeNodeProbe $node $directory '--check server.cjs'
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne $serverHash -or (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -cne $before) { throw 'Runtime or server bytes changed.' }
  [ordered]@{schema=1;nodeVersion=$identity.version;nodeAbi=$identity.abi;nodeExecutableSha256=$before;serverSha256=$serverHash;testedImageId=$image;serverSyntaxPassed=$true;nativeDependenciesVerified=$false;nativeStartupVerified=$false;activationAllowed=$false;startupAllowed=$false;repairApplied=$false}
 } finally {
  try {
   if ($container) { & docker rm -v $container | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Inspection container cleanup failed.' } }
  } finally {
   Remove-Item -LiteralPath $directory -Recurse -Force
  }
 }
}
