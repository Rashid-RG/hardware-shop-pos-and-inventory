$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-setup-destination.ps1')
$fixture=Join-Path $env:RUNNER_TEMP ('ars-destination-'+[guid]::NewGuid())
$source=Join-Path $fixture 'source'
$destination=Join-Path $fixture 'installed'
[void][IO.Directory]::CreateDirectory($source)
try {
 $manifest=[ordered]@{}
 foreach ($name in @('package.json','package-lock.json','scripts/setup-wizard.ps1','Launch-Hardware-POS.vbs','PILOT-RELEASE.json')) {
  $file=Join-Path $source $name
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $file))
  [IO.File]::WriteAllText($file,$name)
  $manifest[$name]=@{sha256=(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant();mode=420}
 }
 $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $source 'PILOT-FILES.json')
 Copy-ArsPilotRelease $source $destination
 if ((Get-Content -LiteralPath (Join-Path $destination 'package.json') -Raw) -cne 'package.json') { throw 'Copied content mismatch.' }
 $blocked=$false
 try { Copy-ArsPilotRelease $source $destination } catch { $blocked=$true }
 if (-not $blocked) { throw 'Existing destination was not rejected.' }
 [IO.File]::WriteAllText((Join-Path $source 'package.json'),'tampered')
 $blocked=$false
 try { Copy-ArsPilotRelease $source (Join-Path $fixture 'other') } catch { $blocked=$true }
 if (-not $blocked -or (Test-Path -LiteralPath (Join-Path $fixture 'other'))) { throw 'Tampered package was not rejected before copying.' }
} finally { Remove-Item -LiteralPath $fixture -Recurse -Force }
