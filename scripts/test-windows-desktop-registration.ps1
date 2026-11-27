$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-desktop-registration.ps1')
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('ars-registration-ci-'+[guid]::NewGuid().ToString('N'))
$project=Join-Path $fixture 'app'
$state=Join-Path $fixture 'state'
$desktop=Join-Path $fixture 'desktop'
$programs=Join-Path $fixture 'programs'
try {
 foreach ($p in @($state,$desktop,$programs,(Join-Path $project 'public'))) {[void][IO.Directory]::CreateDirectory($p)}
 foreach ($name in @('Launch-Hardware-POS.vbs','Maintenance-ARS-Distributor.vbs','public/ars-desktop.ico')) {[IO.File]::WriteAllText((Join-Path $project $name),'fixture')}
 Assert-ArsRegistrationVacant $desktop $programs
 $shell=New-Object -ComObject WScript.Shell
 foreach ($entry in (Get-ArsRegistrationPaths $desktop $programs)) {
  $link=$shell.CreateShortcut($entry.path)
  $link.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe'
  $link.Arguments='"'+(Join-Path $project $entry.launcher)+'"'
  $link.WorkingDirectory=$project
  $link.IconLocation=(Join-Path $project 'public\ars-desktop.ico')+',0'
  $link.Save()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($link)
 }
 Write-ArsDesktopRegistration $project $state $desktop $programs
 $result=Review-ArsDesktopRegistration $project $state $desktop $programs
 if (-not $result.registrationMatched -or $result.shortcutRemovalAllowed) {throw 'Unsafe registration result.'}
 $blocked=$false
 try {Assert-ArsRegistrationVacant $desktop $programs} catch {$blocked=$true}
 if (-not $blocked) {throw 'Existing shortcut collision accepted.'}
 $path=Join-Path $desktop 'ARS Distributor.lnk'
 $link=$shell.CreateShortcut($path)
 $link.Arguments='unrelated.vbs'
 $link.Save()
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($link)
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
 $blocked=$false
 try {Review-ArsDesktopRegistration $project $state $desktop $programs|Out-Null} catch {$blocked=$true}
 if (-not $blocked -or -not [IO.File]::Exists($path)) {throw 'Changed shortcut not protected.'}
} finally {if ([IO.Directory]::Exists($fixture)) {Remove-Item -LiteralPath $fixture -Recurse -Force}}
