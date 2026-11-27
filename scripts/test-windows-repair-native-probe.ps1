$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-repair-native-probe.ps1')
$identity=[pscustomobject]@{platform='win32';arch='x64';version='22.12.0';abi='127'}
Assert-ArsNativeNodeIdentity $identity
foreach ($case in @(@('platform','linux'),@('arch','arm64'),@('version','22.11.0'),@('abi','invalid'))) {
 $key=$case[0]; $old=$identity.$key; $identity.$key=$case[1]
 $blocked=$false
 try { Assert-ArsNativeNodeIdentity $identity } catch { $blocked=$true }
 if (-not $blocked) { throw 'Incompatible runtime accepted.' }
 $identity.$key=$old
}
$node=(Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$dir=Join-Path $env:RUNNER_TEMP ('ars-native-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
try {
 [IO.File]::WriteAllText((Join-Path $dir 'server.cjs'),'throw new Error("must not execute");')
 $null=Invoke-ArsNativeNodeProbe $node $dir '--check server.cjs'
 [IO.File]::WriteAllText((Join-Path $dir 'server.cjs'),'const = ;')
 $blocked=$false
 try { $null=Invoke-ArsNativeNodeProbe $node $dir '--check server.cjs' } catch { $blocked=$true }
 if (-not $blocked) { throw 'Invalid syntax accepted.' }
} finally { Remove-Item -LiteralPath $dir -Recurse -Force }
