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
$form.ClientSize=New-Object Drawing.Size(670,466)
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
$incidentReview=New-Object Windows.Forms.Button
$incidentReview.Text='Review incident'
$incidentReview.SetBounds(406,284,236,38)
$incidentReview.Enabled=$false
$form.Controls.Add($incidentReview)
$authRecord=New-Object Windows.Forms.Button
$authRecord.Text='Record admin review'
$authRecord.SetBounds(26,330,290,38)
$authRecord.Enabled=$false
$form.Controls.Add($authRecord)
$authVerify=New-Object Windows.Forms.Button
$authVerify.Text='Verify admin review'
$authVerify.SetBounds(326,330,316,38)
$authVerify.Enabled=$false
$form.Controls.Add($authVerify)
$close=New-Object Windows.Forms.Button
$close.Text='Close'
$close.SetBounds(522,404,120,38)
$form.Controls.Add($close)
$intent=New-Object Windows.Forms.Button
$intent.Text='Retain intent'
$intent.SetBounds(26,404,150,38)
$form.Controls.Add($intent)
$intentVerify=New-Object Windows.Forms.Button
$intentVerify.Text='Verify intent'
$intentVerify.SetBounds(186,404,150,38)
$form.Controls.Add($intentVerify)
$intentCancel=New-Object Windows.Forms.Button
$intentCancel.Text='Cancel intent'
$intentCancel.SetBounds(346,404,166,38)
$form.Controls.Add($intentCancel)
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
 $incidentReview.Enabled=$false
 $authRecord.Enabled=$false
 $authVerify.Enabled=$false
 # Any incident entry, including malformed evidence, requires support review.
 try {
  $cursor=$control
  while ($cursor) {
   $item=Get-Item -LiteralPath $cursor -Force
   if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid control directory.' }
   $cursor=Split-Path -Parent $cursor
  }
  $blocked=@(Get-ChildItem -LiteralPath $control -Force | Where-Object { $_.Name -ieq 'runtime-activation-interrupted.json' }).Count -ne 0
  $incidentReview.Enabled=($blocked -and $select.SelectedIndex -ge 0)
  $authRecord.Enabled=$incidentReview.Enabled
  $authVerify.Enabled=$incidentReview.Enabled
 } catch { $blocked=$true }
 if ($blocked) {
  foreach ($button in @($prepare,$verify,$intent,$intentVerify,$intentCancel)) {$button.Enabled=$false}
  $status.Text='Activation incident retained or control directory unavailable. Update actions are blocked. Select the matching archive and review incident evidence. No evidence will be removed.'
  $status.ForeColor=[Drawing.Color]::DarkRed
  return
 }
 $exists=Test-Path -LiteralPath (Join-Path $control 'runtime-activation-proposal.json')
 $prepare.Enabled=($select.SelectedIndex -ge 0 -and -not $exists)
 $verify.Enabled=($select.SelectedIndex -ge 0 -and $exists)
 $hasIntent=Test-Path -LiteralPath (Join-Path $control 'runtime-switch-intent.json')
 $intent.Enabled=($select.SelectedIndex -ge 0 -and $exists -and -not $hasIntent)
 $intentVerify.Enabled=($select.SelectedIndex -ge 0 -and $hasIntent)
 $intentCancel.Enabled=$intentVerify.Enabled
}
function Invoke-Review([bool]$Verification) {
 $id=[string]$select.SelectedItem
 if ($id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') { return }
 if (-not $Verification) {
  $answer=[Windows.Forms.MessageBox]::Show('Retain an activation proposal for this archive? This does not install an update, resume billing or restore live data.','ARS Distributor',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Question,[Windows.Forms.MessageBoxDefaultButton]::Button2)
  if ($answer -ne [Windows.Forms.DialogResult]::Yes) { return }
 }
 $incidentReview.Enabled=$false
 $authRecord.Enabled=$false
 $authVerify.Enabled=$false
 $prepare.Enabled=$false
 $verify.Enabled=$false
 $select.Enabled=$false
 $intent.Enabled=$false
 $intentVerify.Enabled=$false
 $intentCancel.Enabled=$false
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
function Invoke-Intent([string]$Mode) {
 $id=[string]$select.SelectedItem
 if ($id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$' -or $Mode -cnotin @('retain','verify','cancel')) { return }
 if ($Mode -ne 'verify') {
  $message=if ($Mode -eq 'cancel') {'Cancel intent and retain original evidence? Maintenance remains active; billing will not resume.'} else {'Retain switch intent? Ordinary startup remains blocked until resolved. This does not install an update.'}
  $answer=[Windows.Forms.MessageBox]::Show($message,'ARS Distributor',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Question,[Windows.Forms.MessageBoxDefaultButton]::Button2)
  if ($answer -ne [Windows.Forms.DialogResult]::Yes) { return }
 }
 foreach ($button in @($prepare,$verify,$intent,$intentVerify,$intentCancel,$incidentReview,$authRecord,$authVerify,$close,$select)) {$button.Enabled=$false}
 $status.Text='Verifying switch intent and retained update evidence...'
 $form.Refresh()
 try {
  $helper=Join-Path $PSScriptRoot 'prepare-windows-switch-intent.ps1'
  $raw=switch ($Mode) {
   'retain' { & $helper -RecoveryId $id -Confirmation 'RETAIN SWITCH INTENT' }
   'verify' { & $helper -RecoveryId $id -Verify }
   'cancel' { & $helper -RecoveryId $id -Cancel -Confirmation 'CANCEL SWITCH INTENT' }
  }
  $data=($raw -join [Environment]::NewLine) | ConvertFrom-Json
  if ($data.schema -ne 1 -or $data.intentDigest -notmatch '^[a-fA-F0-9]{64}$' -or $data.activationAllowed -ne $false -or $data.startupAllowed -ne $false -or $data.rollbackAllowed -ne $false) {throw 'Unexpected result.'}
  if ($Mode -eq 'cancel') {
   if ($data.intentCancelled -ne $true -or $data.maintenanceRetained -ne $true) {throw 'Cancellation not verified.'}
   $status.Text='Intent cancelled. Original evidence retained. Maintenance remains active.'
  } else {
   if ($data.intentMatched -ne $true) {throw 'Intent not verified.'}
   $status.Text='Switch intent verified. Live installation remains locked.'
  }
  $status.ForeColor=[Drawing.Color]::DarkGreen
 } catch {
  $status.Text='Switch intent operation blocked or unverified. Contact RS Nextward before resuming billing.'
  $status.ForeColor=[Drawing.Color]::DarkRed
 } finally {
  $select.Enabled=$true
  $close.Enabled=$true
  Update-Buttons
 }
}
function Invoke-AuthenticatedReview([string]$Mode) {
 $id=[string]$select.SelectedItem
 if ($Mode -cnotin @('record','verify') -or $id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') {return}
 $dialog=New-Object Windows.Forms.Form
 $dialog.Text='ARS Distributor | Administrator recovery review'
 $dialog.ClientSize=New-Object Drawing.Size(480,328)
 $dialog.StartPosition='CenterParent'
 $dialog.FormBorderStyle='FixedDialog'
 $dialog.MaximizeBox=$false
 $dialog.MinimizeBox=$false
 $fields=@()
 $process=$null
 try {
  $names=@('Operator Super Admin email','Operator password','Reviewer Super Admin email','Reviewer password')
  for ($n=0;$n -lt 4;$n++) {
   $lab=New-Object Windows.Forms.Label
   $lab.Text=$names[$n]
   $lab.SetBounds(20,(12+64*$n),440,20)
   $dialog.Controls.Add($lab)
   $field=New-Object Windows.Forms.TextBox
   $field.SetBounds(20,(34+64*$n),440,26)
   $field.MaxLength=254
   if ($n % 2 -eq 1) {$field.UseSystemPasswordChar=$true;$field.MaxLength=72;$field.ShortcutsEnabled=$false}
   $dialog.Controls.Add($field)
   $fields+= $field
  }
  $ok=New-Object Windows.Forms.Button
  $ok.Text='Verify'
  $ok.SetBounds(230,278,110,32)
  $ok.DialogResult=[Windows.Forms.DialogResult]::OK
  $dialog.Controls.Add($ok)
  $cancel=New-Object Windows.Forms.Button
  $cancel.Text='Cancel'
  $cancel.SetBounds(350,278,110,32)
  $cancel.DialogResult=[Windows.Forms.DialogResult]::Cancel
  $dialog.Controls.Add($cancel)
  $dialog.AcceptButton=$ok
  $dialog.CancelButton=$cancel
  if ($dialog.ShowDialog($form) -ne [Windows.Forms.DialogResult]::OK) {return}
  foreach ($button in @($prepare,$verify,$intent,$intentVerify,$intentCancel,$incidentReview,$authRecord,$authVerify,$close,$select)) {$button.Enabled=$false}
  $status.Text='Checking administrator credentials and retained evidence...'
  $form.Refresh()
  $payload=@{recoveryId=$id;mode=$Mode;confirmation='REVIEW ACTIVATION INCIDENT';operator=@{email=$fields[0].Text;password=$fields[1].Text};reviewer=@{email=$fields[2].Text;password=$fields[3].Text}} | ConvertTo-Json -Depth 4 -Compress
  foreach ($field in $fields) {$field.Clear()}
  $psi=New-Object Diagnostics.ProcessStartInfo
  $psi.FileName=(Get-Command node -CommandType Application -ErrorAction Stop).Source
  $psi.Arguments='"'+(Join-Path $PSScriptRoot 'activation-incident-review-cli.mjs')+'"'
  $psi.WorkingDirectory=Split-Path -Parent $PSScriptRoot
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.RedirectStandardInput=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  $process=[Diagnostics.Process]::Start($psi)
  $out=$process.StandardOutput.ReadToEndAsync()
  $err=$process.StandardError.ReadToEndAsync()
  $bytes=[Text.Encoding]::UTF8.GetBytes($payload)
  try {$process.StandardInput.BaseStream.Write($bytes,0,$bytes.Length)} finally {[Array]::Clear($bytes,0,$bytes.Length);$payload=$null;$process.StandardInput.Close()}
  if (-not $process.WaitForExit(1900000)) {$process.Kill();throw 'Review timed out.'}
  if ($process.ExitCode -ne 0) {throw 'Review blocked.'}
  $data=$out.GetAwaiter().GetResult() | ConvertFrom-Json
  $expected=if ($Mode -eq 'record') {'activation-observation-retained'} else {'activation-observation-matched'}
  if ($data.state -cne $expected -or $data.freshCredentialsRequired -ne $true -or $data.recordDigest -cnotmatch '^[a-f0-9]{64}$') {throw 'Unexpected review result.'}
  foreach ($flag in @('activationAllowed','startupAllowed','rollbackAllowed','runtimeActivated','recoveryAllowed','continuousExclusionVerified')) {
   if ($data.$flag -isnot [bool] -or $data.$flag) {throw 'Unexpected authorization.'}
  }
  [void][Windows.Forms.MessageBox]::Show('Authenticated review retained or matched. Incident remains retained. Startup is locked.','ARS Distributor','OK','Information')
 } catch {
  [void][Windows.Forms.MessageBox]::Show('Authenticated review blocked. Contact RS Nextward support. No incident was cleared.','ARS Distributor','OK','Warning')
 } finally {
  foreach ($field in $fields) {$field.Clear()}
  $dialog.Dispose()
  if ($process) {$process.Dispose()}
  $select.Enabled=$true
  $close.Enabled=$true
  Update-Buttons
 }
}
$authRecord.Add_Click({Invoke-AuthenticatedReview 'record'})
$authVerify.Add_Click({Invoke-AuthenticatedReview 'verify'})
$incidentReview.Add_Click({
 $id=[string]$select.SelectedItem
 if ($id -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$') {return}
 foreach ($button in @($prepare,$verify,$intent,$intentVerify,$intentCancel,$incidentReview,$authRecord,$authVerify,$close,$select)) {$button.Enabled=$false}
 $status.Text='Verifying incident evidence. No live changes will be made.'
 $form.Refresh()
 $message='Incident review blocked. Contact RS Nextward support. Evidence remains retained.'
 $success=$false
 try {
  $helper=Join-Path $PSScriptRoot 'prepare-windows-runtime-activation.ps1'
  $data=(@(& $helper -RecoveryId $id -ReviewIncident) -join [Environment]::NewLine) | ConvertFrom-Json
  if ($data.schema -ne 1 -or $data.kind -cne 'windows-activation-incident-review' -or $data.snapshot.recoveryId -cne $id -or $data.incidentDigest -notmatch '^[A-Fa-f0-9]{64}$' -or $data.incidentRetained -ne $true -or $data.administratorApprovalRequired -ne $true) {throw 'Invalid review.'}
  foreach ($flag in @('activationAllowed','startupAllowed','rollbackAllowed','runtimeActivated','recoveryAllowed','continuousExclusionVerified')) {
   if ($data.$flag -isnot [bool] -or $data.$flag) {throw 'Unexpected authorization.'}
  }
  $message='Incident evidence matched. Administrator review is still required. Startup and live installation remain locked.'
  $success=$true
 } catch {} finally {
  $select.Enabled=$true
  $close.Enabled=$true
  Update-Buttons
 }
 [void][Windows.Forms.MessageBox]::Show($message,'ARS Distributor',[Windows.Forms.MessageBoxButtons]::OK,$(if ($success) {[Windows.Forms.MessageBoxIcon]::Information} else {[Windows.Forms.MessageBoxIcon]::Warning}))
})
$intent.Add_Click({Invoke-Intent 'retain'})
$intentVerify.Add_Click({Invoke-Intent 'verify'})
$intentCancel.Add_Click({Invoke-Intent 'cancel'})
$select.Add_SelectedIndexChanged({Update-Buttons})
$prepare.Add_Click({Invoke-Review $false})
$verify.Add_Click({Invoke-Review $true})
try { Refresh-Choices; Update-Buttons; [void]$form.ShowDialog() } finally { $form.Dispose() }
