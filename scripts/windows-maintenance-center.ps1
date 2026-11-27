# Read-only maintenance overview. Never starts/stops services or modifies data.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$root=Split-Path -Parent $PSScriptRoot
$title='RS Nextward | ARS Distributor Maintenance Center'
. (Join-Path $PSScriptRoot 'windows-setup-ui.ps1')
function Get-ArsMaintenanceSummary {
 $control=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\desktop-control'
 $held=$false
 foreach ($name in @('maintenance.json','runtime-activation-interrupted.json','runtime-switch-intent.json','handoff-pending.json')) {
  if (Test-Path -LiteralPath (Join-Path $control $name)) { $held=$true }
 }
 $build=(Test-Path -LiteralPath (Join-Path $root 'dist/server.cjs') -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $root 'dist/index.html') -PathType Leaf)
 $config=Test-Path -LiteralPath (Join-Path $root '.env.local') -PathType Leaf
 $ready=$false
 if (-not $held) {
  try {
   $request=[Net.HttpWebRequest]::Create('http://127.0.0.1:3000/api/ready')
   $request.Proxy=$null
   $request.AllowAutoRedirect=$false
   $request.Timeout=3000
   $response=$request.GetResponse()
   try {
    $reader=New-Object IO.StreamReader($response.GetResponseStream())
    try {
     $buffer=New-Object char[] 65537
     $count=$reader.ReadBlock($buffer,0,$buffer.Length)
     if ($count -lt $buffer.Length) {
      $data=(-join $buffer[0..($count-1)]) | ConvertFrom-Json
      $ready=$data.ok -eq $true -and $data.status -eq 'ready' -and $data.database -eq 'reachable' -and $data.sourceOfTruth -eq 'normalized'
     }
    } finally { $reader.Dispose() }
   } finally { $response.Dispose() }
  } catch {}
 }
 @(
  ('Production files: '+$(if ($build) {'Present'} else {'Review required'}))
  ('Runtime configuration: '+$(if ($config) {'Present (not validated)'} else {'Review required'}))
  ('Maintenance evidence: '+$(if ($held) {'Review required'} else {'No listed marker found'}))
  ('Database readiness: '+$(if ($ready) {'Endpoint reports ready'} else {'Not confirmed'}))
  ''
  'Read-only checks do not authorize startup. Repair and uninstall remain locked.'
 ) -join [Environment]::NewLine
}
try {
 while (Show-ArsSetupPage 'Maintenance Center' (Get-ArsMaintenanceSummary) 'Refresh') {}
} catch {
 [void][Windows.Forms.MessageBox]::Show('Maintenance diagnostics unavailable. Contact RS Nextward support. No repair or uninstall performed.',$title,'OK','Error')
}
