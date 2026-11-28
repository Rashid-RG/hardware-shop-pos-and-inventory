# Dedicated schedule status window. No scheduling or execution controls.
param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=New-Object Windows.Forms.Form
$form.Text='ARS Distributor | RS Nextward'
$form.ClientSize=New-Object Drawing.Size(530,335)
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.Font=New-Object Drawing.Font('Segoe UI',10)
$form.BackColor=[Drawing.Color]::White
$title=New-Object Windows.Forms.Label
$title.Text='Backup schedule readiness'
$title.Font=New-Object Drawing.Font('Segoe UI',20,[Drawing.FontStyle]::Bold)
$title.SetBounds(22,18,486,44)
$form.Controls.Add($title)
$summary=New-Object Windows.Forms.Label
$summary.Text='Automatic execution is not authorized.'
$summary.SetBounds(24,70,480,145)
$form.Controls.Add($summary)
$refresh=New-Object Windows.Forms.Button
$refresh.Text='Refresh status'
$refresh.SetBounds(24,258,145,38)
$form.Controls.Add($refresh)
$close=New-Object Windows.Forms.Button
$close.Text='Close'
$close.SetBounds(384,258,120,38)
$form.Controls.Add($close)
$close.Add_Click({$form.Close()})
$refresh.Add_Click({
  $refresh.Enabled=$false
  try {
    $data=(@(& (Join-Path $PSScriptRoot 'inspect-windows-backup-schedule.ps1')) -join [Environment]::NewLine) | ConvertFrom-Json
    if ($data.schema -ne 1 -or $data.activationAllowed -ne $false -or $data.uploadAllowed -ne $false) { throw 'Unexpected schedule status.' }
    $time=if ($data.dailyLocalTime) {$data.dailyLocalTime} else {'Not configured'}
    $summary.Text=@("Daily local time: $time","Saved proposal: $($data.proposalState)","Scheduled task: $($data.taskState)",'Automatic execution remains disabled in this workflow.','Runtime and recovery acceptance are still required.') -join [Environment]::NewLine
  } catch {
    $summary.Text='Schedule status unavailable. Review the prepared launcher and scheduled tasks with RS Nextward support. No changes made.'
  } finally { $refresh.Enabled=$true }
})
$form.Add_Shown({$refresh.PerformClick()})
try { [void]$form.ShowDialog() } finally { $form.Dispose() }
