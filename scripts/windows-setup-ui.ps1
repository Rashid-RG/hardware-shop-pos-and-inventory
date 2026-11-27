# Branded Windows Forms setup pages. Installation logic remains in setup-wizard.ps1.
Add-Type -AssemblyName System.Drawing
function New-ArsSetupForm([string]$heading) {
 $form=New-Object Windows.Forms.Form
 $form.Text=$title
 $form.ClientSize=New-Object Drawing.Size(640,420)
 $form.StartPosition='CenterScreen'
 $form.FormBorderStyle='FixedDialog'
 $form.MaximizeBox=$false
 $form.MinimizeBox=$false
 $form.Font=New-Object Drawing.Font('Segoe UI',10)
 $form.BackColor=[Drawing.Color]::White
 $header=New-Object Windows.Forms.Label
 $header.SetBounds(24,86,592,38)
 $header.Font=New-Object Drawing.Font('Segoe UI',19,[Drawing.FontStyle]::Bold)
 $header.Text=$heading
 $form.Controls.Add($header)
 # Reuse the exact corporate print artwork, not a substitute logo.
 $source=Get-Content -LiteralPath (Join-Path $root 'src\utils\rsNextwardPrintLogo.ts') -Raw
 if ($source -notmatch "rsNextwardLogoBase64='([A-Za-z0-9+/=]+)'") { throw 'Official setup artwork is missing.' }
 $stream=New-Object IO.MemoryStream(,[Convert]::FromBase64String($Matches[1]))
 try {
  $original=[Drawing.Image]::FromStream($stream)
  try { $logo=New-Object Drawing.Bitmap($original) } finally { $original.Dispose() }
 } finally { $stream.Dispose() }
 $picture=New-Object Windows.Forms.PictureBox
 $picture.SetBounds(24,18,230,48)
 $picture.SizeMode='Zoom'
 $picture.Image=$logo
 $form.Controls.Add($picture)
 $form.Add_Disposed({ $logo.Dispose() }.GetNewClosure())
 $form
}
function Add-ArsSetupButton($form,[string]$label,[int]$x,[string]$result) {
 $button=New-Object Windows.Forms.Button
 $button.Text=$label
 $button.SetBounds($x,362,132,36)
 $button.DialogResult=[Windows.Forms.DialogResult]$result
 $form.Controls.Add($button)
 $button
}
function Show-ArsSetupPage([string]$heading,[string]$message,[string]$next='Next',[switch]$Agreement) {
 $form=New-ArsSetupForm $heading
 try {
  $body=New-Object Windows.Forms.TextBox
  $body.Multiline=$true
  $body.ReadOnly=$true
  $body.ScrollBars='Vertical'
  $body.BorderStyle='None'
  $body.BackColor=[Drawing.Color]::White
  $body.SetBounds(26,138,586,190)
  $body.Text=$message
  $form.Controls.Add($body)
  $ok=Add-ArsSetupButton $form $next 482 'OK'
  $cancel=Add-ArsSetupButton $form 'Cancel' 338 'Cancel'
  $form.CancelButton=$cancel
  if ($Agreement) {
   $body.Height=158
   $accept=New-Object Windows.Forms.RadioButton
   $accept.Text='I accept the installation conditions'
   $accept.SetBounds(26,298,580,26)
   $decline=New-Object Windows.Forms.RadioButton
   $decline.Text='I do not accept the installation conditions'
   $decline.SetBounds(26,326,580,26)
   $decline.Checked=$true
   $form.Controls.Add($accept)
   $form.Controls.Add($decline)
   $ok.Enabled=$false
   $accept.Add_CheckedChanged({$ok.Enabled=$accept.Checked}.GetNewClosure())
  }
  return $form.ShowDialog() -eq [Windows.Forms.DialogResult]::OK
 } finally { $form.Dispose() }
}
function Open-ArsProgress {
 $script:progressForm=New-ArsSetupForm 'Installing ARS Distributor'
 $script:progressForm.ControlBox=$false
 $script:progressText=New-Object Windows.Forms.Label
 $script:progressText.SetBounds(26,154,586,70)
 $script:progressForm.Controls.Add($script:progressText)
 $script:progressBar=New-Object Windows.Forms.ProgressBar
 $script:progressBar.SetBounds(26,244,586,22)
 $script:progressBar.Maximum=5
 $script:progressForm.Controls.Add($script:progressBar)
 $script:progressForm.Show()
 [Windows.Forms.Application]::DoEvents()
}
function Set-ArsProgress([int]$completed,[string]$stage) {
 $script:progressText.Text=$stage
 $script:progressBar.Value=$completed
 [Windows.Forms.Application]::DoEvents()
}
function Close-ArsProgress {
 if ($script:progressForm) { $script:progressForm.Dispose(); $script:progressForm=$null }
}
