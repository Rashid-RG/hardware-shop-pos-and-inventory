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
$work=$null
try {
 $commit='077a41dc474d578200ca72ec370baf62bf16de14'
 $public=Join-Path (Split-Path -Parent $PSScriptRoot) 'release-trust\release-signing-public.pem'
 if ([Windows.Forms.MessageBox]::Show("Sign the Windows and Mint installers from successful CI build #3069 only. This does not publish or install anything.",$title,'OKCancel','Information') -ne 'OK') { return }
 $windowsZip=Pick-File 'Select original Windows CI artifact ZIP' 'ZIP archive (*.zip)|*.zip'
 $mintZip=Pick-File 'Select original Linux Mint CI artifact ZIP' 'ZIP archive (*.zip)|*.zip'
 if ((Get-FileHash -LiteralPath $windowsZip -Algorithm SHA256).Hash -ine 'c6d18631bb0c12b58cd285679303068d1e8bbb2e4ccc754c015eefd926129cfc') { throw 'Windows artifact does not match approved CI build #3069.' }
 if ((Get-FileHash -LiteralPath $mintZip -Algorithm SHA256).Hash -ine '481dc164cff2d902fec1c8677ff610a9c5272d3fb9a59a7be73259c50bf9e73a') { throw 'Mint artifact does not match approved CI build #3069.' }
 $work=Join-Path ([IO.Path]::GetTempPath()) ('ars-sign-'+[guid]::NewGuid().ToString('N'))
 [void][IO.Directory]::CreateDirectory($work)
 Expand-Archive -LiteralPath $windowsZip -DestinationPath (Join-Path $work 'windows')
 Expand-Archive -LiteralPath $mintZip -DestinationPath (Join-Path $work 'mint')
 $windowsFiles=@(Get-ChildItem -LiteralPath (Join-Path $work 'windows') -Recurse -File -Filter '*.exe')
 $mintFiles=@(Get-ChildItem -LiteralPath (Join-Path $work 'mint') -Recurse -File -Filter '*.deb')
 if ($windowsFiles.Count -ne 1 -or $mintFiles.Count -ne 1) { throw 'Unexpected CI artifact contents.' }
 $windows=$windowsFiles[0].FullName
 $mint=$mintFiles[0].FullName
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
} finally {
 if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force }
}
