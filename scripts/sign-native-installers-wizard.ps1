# Owner-only graphical signing wizard. No publication or installation.
Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference='Stop'
$title='RS Nextward | Installer Signing'
function Pick-File($caption,$filter) {
 $d=New-Object Windows.Forms.OpenFileDialog
 try {
  $d.Title=$caption; $d.Filter=$filter; $d.CheckFileExists=$true
  if ($d.ShowDialog() -ne 'OK') { throw [OperationCanceledException]::new() }
  return $d.FileName
 } finally { $d.Dispose() }
}
try {
 $commit='7915f457b664c0f0e352f5c716553cb61f481aa1'
 $public=Join-Path (Split-Path -Parent $PSScriptRoot) 'release-trust\release-signing-public.pem'
 if ([Windows.Forms.MessageBox]::Show("Sign the Windows and Mint installers from successful CI build #3064 only. This does not publish or install anything.",$title,'OKCancel','Information') -ne 'OK') { return }
 $windows=Pick-File 'Select extracted Windows CI installer' 'Windows installer (*.exe)|*.exe'
 $mint=Pick-File 'Select extracted Linux Mint CI installer' 'Linux installer (*.deb)|*.deb'
 $private=Pick-File 'Select your encrypted private signing key (stays local)' 'PEM key (*.pem)|*.pem'
 $openssl=Get-Command openssl.exe -ErrorAction SilentlyContinue
 if ($openssl) { $opensslPath=$openssl.Source } else { $opensslPath=Pick-File 'Select your existing OpenSSL executable' 'OpenSSL (openssl.exe)|openssl.exe' }
 $env:PATH=(Split-Path -Parent $opensslPath)+';'+$env:PATH
 $folder=New-Object Windows.Forms.FolderBrowserDialog
 try {
  $folder.Description='Choose a parent folder for signed acceptance installers'
  if ($folder.ShowDialog() -ne 'OK') { return }
  $output=Join-Path $folder.SelectedPath ('ARS-Signed-'+$commit.Substring(0,12))
 } finally { $folder.Dispose() }
 $python=Get-Command py.exe -ErrorAction SilentlyContinue
 if (-not $python) { throw 'Python 3.11 or newer is required on the signing workstation.' }
 # OpenSSL requests the passphrase in the local console, never via arguments.
 & $python.Source -3 (Join-Path $PSScriptRoot 'sign-native-installers.py') --windows $windows --mint $mint --private-key $private --public-key $public --output $output --commit $commit
 if ($LASTEXITCODE -ne 0) { throw 'Signing or verification failed. Do not distribute these files.' }
 [void][Windows.Forms.MessageBox]::Show("Signatures verified. Acceptance packages saved to: $output",$title,'OK','Information')
 Start-Process explorer.exe -ArgumentList ('"'+$output+'"')
} catch [OperationCanceledException] {
 return
} catch {
 [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,$title,'OK','Error')
 exit 1
}
