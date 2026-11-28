# Windows Maintenance Center for diagnostics and explicitly approved maintenance tools.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$root=Split-Path -Parent $PSScriptRoot
$title='RS Nextward | ARS Distributor Maintenance Center'
. (Join-Path $PSScriptRoot 'windows-setup-ui.ps1')
. (Join-Path $PSScriptRoot 'windows-uninstall-preview.ps1')
. (Join-Path $PSScriptRoot 'windows-repair-activation-plan.ps1')
. (Join-Path $PSScriptRoot 'windows-repair-interruption.ps1')
function Get-ArsMaintenanceSummary {
 $control=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\desktop-control'
 $held=$false
 foreach ($name in @('maintenance.json','runtime-activation-interrupted.json','runtime-switch-intent.json','handoff-pending.json','repair-interrupted.json')) {
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
  'Diagnostics and isolated repair preparation. Repair activation and uninstall remain locked.'
 ) -join [Environment]::NewLine
}
try {
 while (Show-ArsSetupPage 'Maintenance Center' (Get-ArsMaintenanceSummary) 'Maintenance tools') {
  $control=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor\desktop-control'
  if (@(Get-ChildItem -LiteralPath $control -Force -ErrorAction SilentlyContinue | Where-Object Name -eq 'repair-interrupted.json').Count) {
   try {
    $null=Review-ArsRepairInterruption
    [void][Windows.Forms.MessageBox]::Show('Interruption evidence and rollback preparation matched. Startup remains blocked. Contact RS Nextward support.',$title,'OK','Information')
   } catch {
    [void][Windows.Forms.MessageBox]::Show('Interruption evidence could not be verified. Marker retained. No startup or rollback performed.',$title,'OK','Error')
   }
   break
  }
  if ([Windows.Forms.MessageBox]::Show('Open the data-preserving Uninstall Wizard preview?',$title,'YesNo','Question') -eq 'Yes') {
   Show-ArsUninstallPreview $root
   continue
  }
  if ([Windows.Forms.MessageBox]::Show('Review completed repair readiness evidence?',$title,'YesNo','Question') -eq 'Yes') {
   $picker=New-Object Windows.Forms.FolderBrowserDialog
   try {
    $picker.Description='Select completed managed repair preparation'
    if ($picker.ShowDialog() -ne 'OK') { continue }
    $folder=$picker.SelectedPath
   } finally { $picker.Dispose() }
   try {
    $review=Get-ArsRepairReadiness $root $folder
    if (Test-Path -LiteralPath (Join-Path $folder 'rollback-preparation.json')) {
     if ([Windows.Forms.MessageBox]::Show('Prepare or verify the protected repair activation plan? No files will be switched.',$title,'YesNo','Question') -eq 'Yes') {
      $null=Prepare-ArsRepairActivationPlan $root $folder
      [void][Windows.Forms.MessageBox]::Show('Activation plan verified. Live file switching, startup and rollback remain locked.',$title,'OK','Information')
     }
     continue
    }
    if ([Windows.Forms.MessageBox]::Show('Prepare rollback evidence for the previous tested application? This does not apply a rollback.',$title,'YesNo','Question') -eq 'Yes') {
     $null=Prepare-ArsRepairRollback $root $folder
     [void][Windows.Forms.MessageBox]::Show('Previous executable and existing rollback evidence matched. Isolated repair-specific backward compatibility evidence matched. Live activation remains locked.',$title,'OK','Information')
    }
    [void][Windows.Forms.MessageBox]::Show('Repair evidence, tested container image, native Node version and server syntax matched. Native dependency loading, Windows startup, writer exclusion and rollback are not certified. Activation remains locked.',$title,'OK','Information')
   } catch {
    [void][Windows.Forms.MessageBox]::Show('Repair readiness review blocked. Missing, stale or altered evidence. No repair applied.',$title,'OK','Error')
   }
   continue
  }
  $choice=[Windows.Forms.MessageBox]::Show('Prepare new repair files? Choose Yes. To review existing repair backup evidence, choose No.',$title,'YesNoCancel','Question')
  if ($choice -eq 'Cancel') { continue }
  if ($choice -eq 'No') {
   $test=[Windows.Forms.MessageBox]::Show('Run isolated repair restoration rehearsal? Choose Yes. To review backup evidence first, choose No.',$title,'YesNoCancel','Question')
   if ($test -eq 'Cancel') { continue }
   if ($test -eq 'Yes') {
    $picker=New-Object Windows.Forms.FolderBrowserDialog
    try {
     $picker.Description='Select managed repair preparation folder'
     if ($picker.ShowDialog() -ne 'OK') { continue }
     $repairFolder=$picker.SelectedPath
    } finally { $picker.Dispose() }
    if (-not (Show-ArsSetupPage 'Isolated repair test' 'Build the exact repair package and restore into a disposable disconnected database? Internet access for dependencies is required. No live repair will be applied.' 'Run test')) { continue }
    try {
     Invoke-ArsRepairRehearsal $root $repairFolder
     [void][Windows.Forms.MessageBox]::Show('Isolated repair rehearsal completed. Activation remains locked.',$title,'OK','Information')
    } catch {
     [void][Windows.Forms.MessageBox]::Show('Repair rehearsal blocked or failed. No live repair applied. Contact RS Nextward support.',$title,'OK','Error')
    }
    continue
   }
   $picker=New-Object Windows.Forms.FolderBrowserDialog
   try {
    $picker.Description='Select managed repair preparation folder'
    if ($picker.ShowDialog() -ne 'OK') { continue }
    $repairFolder=$picker.SelectedPath
    $picker.Description='Select managed update recovery folder'
    if ($picker.ShowDialog() -ne 'OK') { continue }
    $recoveryFolder=$picker.SelectedPath
   } finally { $picker.Dispose() }
   try {
    $expected=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'RS Nextward\ARS Distributor\update-recovery'
    if ((Split-Path -Parent $recoveryFolder) -ine $expected) { throw 'Managed recovery folder required.' }
    Review-ArsRepairBackup $root $repairFolder (Split-Path -Leaf $recoveryFolder)
    [void][Windows.Forms.MessageBox]::Show('Existing backup evidence matched. Repair candidate restoration testing is still required. Activation remains locked.',$title,'OK','Information')
   } catch {
    [void][Windows.Forms.MessageBox]::Show('Backup review blocked. Existing verified maintenance and restoration evidence is required. No repair applied.',$title,'OK','Error')
   }
   continue
  }
  $picker=New-Object Windows.Forms.FolderBrowserDialog
  try {
   $picker.Description='Select extracted exact-version ARS installation package'
   if ($picker.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { continue }
   $source=$picker.SelectedPath
  } finally { $picker.Dispose() }
  if (-not (Show-ArsSetupPage 'Prepare isolated repair' 'Verify and copy the exact installed package? No live files or database will be replaced. A verified backup is required before activation.' 'Prepare')) { continue }
  try {
   $state=Join-Path $env:LOCALAPPDATA 'RS Nextward\ARS Distributor'
   # State may be absent before the first POS launch; do not silently create it.
   $folder=Prepare-ArsRepair $root $source $state
   [void][Windows.Forms.MessageBox]::Show(('Repair source prepared. No repair applied. Backup and activation review required.'+[Environment]::NewLine+$folder),$title,'OK','Information')
  } catch {
   [void][Windows.Forms.MessageBox]::Show('Repair preparation blocked. Existing application and database retained. Contact RS Nextward support.',$title,'OK','Error')
  }
 }
} catch {
 [void][Windows.Forms.MessageBox]::Show('Maintenance diagnostics unavailable. Contact RS Nextward support. No repair or uninstall performed.',$title,'OK','Error')
}
