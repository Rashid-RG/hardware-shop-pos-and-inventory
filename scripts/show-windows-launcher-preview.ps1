# Graphical read-only preview. No business startup or activation.
param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=New-Object Windows.Forms.Form
$form.Text='ARS Distributor | RS Nextward'
$form.ClientSize=New-Object Drawing.Size(520,310)
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.Font=New-Object Drawing.Font('Segoe UI',10)
$form.BackColor=[Drawing.Color]::White
$heading=New-Object Windows.Forms.Label
$heading.Text='Launcher readiness'
$heading.Font=New-Object Drawing.Font('Segoe UI',21,[Drawing.FontStyle]::Bold)
$heading.SetBounds(24,20,470,44)
$form.Controls.Add($heading)
$subtitle=New-Object Windows.Forms.Label
$subtitle.Text='ARS Distributor  |  Preview only'
$subtitle.SetBounds(26,68,468,30)
$form.Controls.Add($subtitle)
$status=New-Object Windows.Forms.Label
$status.Text='Check the prepared release and registered database. Live startup remains disabled.'
$status.SetBounds(26,112,468,100)
$form.Controls.Add($status)
$check=New-Object Windows.Forms.Button
$check.Text='Verify readiness'
$check.SetBounds(26,232,170,40)
$form.Controls.Add($check)
$close=New-Object Windows.Forms.Button
$close.Text='Close'
$close.SetBounds(374,232,120,40)
$form.Controls.Add($close)
$close.Add_Click({$form.Close()})
$check.Add_Click({
  $check.Enabled=$false
  $status.Text='Checking release and database binding...'
  $form.Refresh()
  try {
    # A retained runtime copy is not a live runtime; explicit selection remains required.
    $raw=@(& (Join-Path $PSScriptRoot 'preview-windows-stable-launcher.ps1'))
    $result=($raw -join [Environment]::NewLine) | ConvertFrom-Json
    if ($result.schema -ne 1 -or $result.fingerprintMatched -ne $true -or $result.databaseBindingMatched -ne $true -or $result.startupAllowed -ne $false) { throw 'Unexpected preview result.' }
    $status.Text="Release $($result.version) and database binding verified. Startup is still disabled."
    $status.ForeColor=[Drawing.Color]::DarkGreen
  } catch {
    # Do not display raw native command output or connection credentials.
    $status.Text='Readiness check blocked. Verify the prepared runtime, release and database binding with RS Nextward support. No changes were made.'
    $status.ForeColor=[Drawing.Color]::DarkRed
  } finally { $check.Enabled=$true }
})
try { [void]$form.ShowDialog() } finally { $form.Dispose() }
