# Dedicated graphical activation proposal review in the existing installation.
param()
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$state=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor'
$control=Join-Path $state 'desktop-control'
$recovery=Join-Path $state 'update-recovery'
$form=New-Object Windows.Forms.Form
$form.Text='ARS Distributor | RS Nextward'
$form.ClientSize=New-Object Drawing.Size(670,345)
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.Font=New-Object Drawing.Font('Segoe UI',10)
$form.BackColor=[Drawing.Color]::White
$title=New-Object Windows.Forms.Label
$title.Text='Activation Review Center'
$title.Font=New-Object Drawing.Font('Segoe UI',20,[Drawing.FontStyle]::Bold)
$title.SetBounds(24,18,620,42)
$form.Controls.Add($title)
$label=New-Object Windows.Forms.Label
$label.Text='Protected recovery archive'
$label.SetBounds(26,74,610,25)
$form.Controls.Add($label)
$select=New-Object Windows.Forms.ComboBox
$select.DropDownStyle='DropDownList'
$select.SetBounds(26,104,616,34)
$form.Controls.Add($select)
$status=New-Object Windows.Forms.Label
$status.Text='Select a recovery archive. Live installation remains locked.'
$status.SetBounds(26,150,616,112)
$form.Controls.Add($status)
$prepare=New-Object Windows.Forms.Button
$prepare.Text='Prepare proposal'
$prepare.SetBounds(26,284,180,38)
$form.Controls.Add($prepare)
$verify=New-Object Windows.Forms.Button
$verify.Text='Verify proposal'
$verify.SetBounds(216,284,180,38)
$form.Controls.Add($verify)
$close=New-Object Windows.Forms.Button
$close.Text='Close'
$close.SetBounds(522,284,120,38)
$form.Controls.Add($close)
$close.Add_Click({$form.Close()})
function Refresh-Choices {
 $select.Items.Clear()
 $prepare.Enabled=$false
 $verify.Enabled=$false
 if (-not (Test-Path -LiteralPath $recovery -PathType Container)) { return }
 $cursor=$recovery
 while ($cursor) {
  $item=Get-Item -LiteralPath $cursor -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid recovery directory.' }
  $cursor=Split-Path -Parent $cursor
 }
 foreach ($folder in @(Get-ChildItem -LiteralPath $recovery -Directory | Sort-Object Name -Descending)) {
  if ($folder.Name -cmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$' -and -not ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)) { [void]$select.Items.Add($folder.Name) }
 }
 if ($select.Items.Count -gt 0) { $select.SelectedIndex=0 }
}
function Update-Buttons {
 $exists=Test-Path -LiteralPath (Join-Path $control 'runtime-activation-proposal.json')
 $prepare.Enabled=($select.SelectedIndex -ge 0 -and -not $exists)
 $verify.Enabled=($select.SelectedIndex -ge 0 -and $exists)
}
function Invoke-Review([bool]$Verification) {
 $id=[string]$select.SelectedItem
 if ($id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { return }
 if (-not $Verification) {
  $answer=[Windows.Forms.MessageBox]::Show('Retain an activation proposal for this archive? This does not install an update, resume billing or restore live data.','ARS Distributor',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Question,[Windows.Forms.MessageBoxDefaultButton]::Button2)
  if ($answer -ne [Windows.Forms.DialogResult]::Yes) { return }
 }
 $prepare.Enabled=$false
 $verify.Enabled=$false
 $select.Enabled=$false
 $close.Enabled=$false
 $status.Text='Checking maintenance, database binding, runtime inventory and recovery evidence...'
 $form.Refresh()
 try {
  $helper=Join-Path $PSScriptRoot 'prepare-windows-runtime-activation.ps1'
  if ($Verification) { $raw=@(& $helper -RecoveryId $id -Verify) }
  else { $raw=@(& $helper -RecoveryId $id -Confirmation 'PREPARE RUNTIME ACTIVATION') }
  $data=($raw -join [Environment]::NewLine) | ConvertFrom-Json
  if ($data.schema -ne 1 -or $data.proposalMatched -ne $true -or $data.recoveryId -cne $id -or $data.proposalDigest -notmatch '^[a-fA-F0-9]{64}$' -or $data.runtimeActivated -ne $false -or $data.activationAllowed -ne $false -or $data.startupAllowed -ne $false -or $data.rollbackAllowed -ne $false) { throw 'Unexpected proposal result.' }
  $status.Text='Activation proposal verified. Live installation and rollback remain locked. Native acceptance and continuous writer protection are still required.'
  $status.ForeColor=[Drawing.Color]::DarkGreen
 } catch {
  $status.Text='Proposal blocked or unavailable. Check the protected backup and compatibility evidence with RS Nextward support. Live activation was not requested.'
  $status.ForeColor=[Drawing.Color]::DarkRed
 } finally {
  $select.Enabled=$true
  $close.Enabled=$true
  Update-Buttons
 }
}
$select.Add_SelectedIndexChanged({Update-Buttons})
$prepare.Add_Click({Invoke-Review $false})
$verify.Add_Click({Invoke-Review $true})
try { Refresh-Choices; Update-Buttons; [void]$form.ShowDialog() } finally { $form.Dispose() }
