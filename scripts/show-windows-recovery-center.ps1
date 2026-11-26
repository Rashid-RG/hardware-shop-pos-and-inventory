# Offline read-only recovery center; no POS startup, restore or marker clearance.
param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'windows-runtime-paths.ps1')
$form=New-Object Windows.Forms.Form
$form.Text='ARS Distributor | RS Nextward'
$form.ClientSize=New-Object Drawing.Size(640,420)
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.Font=New-Object Drawing.Font('Segoe UI',10)
$form.BackColor=[Drawing.Color]::White
$title=New-Object Windows.Forms.Label
$title.Text='Database Recovery Center'
$title.Font=New-Object Drawing.Font('Segoe UI',20,[Drawing.FontStyle]::Bold)
$title.SetBounds(24,18,590,42)
$form.Controls.Add($title)
$sub=New-Object Windows.Forms.Label
$sub.Text='ARS Distributor  |  RS Nextward  |  Read-only diagnostics'
$sub.ForeColor=[Drawing.Color]::DimGray
$sub.SetBounds(26,64,590,25)
$form.Controls.Add($sub)
$status=New-Object Windows.Forms.Label
$status.Text='Ready to inspect retained recovery evidence.'
$status.SetBounds(26,102,590,220)
$form.Controls.Add($status)
$notice=New-Object Windows.Forms.Label
$notice.Text='Recovery and normal startup are not authorized by this screen.'
$notice.ForeColor=[Drawing.Color]::DarkRed
$notice.SetBounds(26,326,590,32)
$form.Controls.Add($notice)
$refresh=New-Object Windows.Forms.Button
$refresh.Text='Run diagnostics'
$refresh.SetBounds(26,370,170,36)
$form.Controls.Add($refresh)
$close=New-Object Windows.Forms.Button
$close.Text='Close'
$close.SetBounds(494,370,120,36)
$form.Controls.Add($close)
$close.Add_Click({$form.Close()})
$refresh.Add_Click({
 $refresh.Enabled=$false
 $status.Text='Inspecting local database binding and incident evidence...'
 $status.Refresh()
 try {
  $root=Get-ArsWindowsRuntimeRoot (Split-Path -Parent $PSScriptRoot)
  $control=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor\desktop-control'
  $binding=Join-Path $control 'database-binding.json'
  $verified=(@(& (Join-Path $PSScriptRoot 'windows-database-binding.ps1')) -join [Environment]::NewLine) | ConvertFrom-Json
  if ($verified.schema -ne 1 -or $verified.bindingMatched -ne $true -or $verified.activationAllowed -ne $false) { throw 'Binding unavailable.' }
  $file=Get-Item -LiteralPath $binding -Force
  if ($file.PSIsContainer -or $file.Length -gt 8192 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid binding.' }
  $saved=Get-Content -LiteralPath $binding -Raw | ConvertFrom-Json
  if ($saved.schema -ne 1 -or $saved.database -cne 'hardware_pos' -or $saved.systemIdentifier -cnotmatch '^[0-9]{1,20}$' -or $saved.databaseOid -cnotmatch '^[0-9]{1,10}$') { throw 'Invalid identity.' }
  $node=(Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $raw=@(& $node (Join-Path $PSScriptRoot 'writer-loss-offline-diagnostics.mjs') $root $saved.database $saved.systemIdentifier $saved.databaseOid 2>$null)
  $data=($raw -join [Environment]::NewLine) | ConvertFrom-Json
  if ($data.startupAllowed -ne $false -or $data.recoveryAllowed -ne $false) { throw 'Unexpected diagnostic output.' }
  if ($data.state -eq 'no-incident-record') { $status.Text='No writer-loss incident was found. This does not authorize startup.'; return }
  if ($data.state -notin @('preflight-matched-review-required','preflight-blocked')) { throw 'Diagnostics unavailable.' }
  $labels=[ordered]@{incidentRetained='Incident evidence retained';evidenceIntegrityMatched='Evidence integrity';restoreReceiptMatched='Isolated restore receipt';databaseIdentityMatched='Database identity';noDatabaseActivityObserved='Outstanding database activity check'}
  $lines=@()
  foreach ($key in $labels.Keys) {
   $result=if ($data.checks.$key -eq $true) {'Matched'} else {'Review required'}
   $lines+=($labels[$key]+': '+$result)
  }
  $lines+='Accounting reconciliation, writer exclusion and operator approval remain required.'
  $status.Text=$lines -join [Environment]::NewLine
 } catch {
  $status.Text='Recovery diagnostics unavailable. A previously registered database binding, valid runtime and retained evidence are required. Contact RS Nextward support. No changes made.'
 } finally { $refresh.Enabled=$true }
})
try { [void]$form.ShowDialog() } finally { $form.Dispose() }
