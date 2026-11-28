# Fresh Windows shortcut registration evidence. No shortcut or service removal.
. (Join-Path $PSScriptRoot 'windows-setup-destination.ps1')
function Get-ArsRegistrationPaths([string]$desktop,[string]$programs) {
 foreach ($folder in @($desktop,$programs)) {
  Assert-ArsPlainPath $folder
  if (-not (Get-Item -LiteralPath $folder -Force).PSIsContainer) {throw 'Invalid shortcut directory.'}
 }
 if ($desktop -ieq $programs) {throw 'Separate shortcut directories required.'}
 @(
  @{path=(Join-Path $desktop 'ARS Distributor.lnk');launcher='Launch-Hardware-POS.vbs'}
  @{path=(Join-Path $programs 'ARS Distributor.lnk');launcher='Launch-Hardware-POS.vbs'}
  @{path=(Join-Path $programs 'RS Nextward Maintenance Center.lnk');launcher='Maintenance-ARS-Distributor.vbs'}
 )
}
function Assert-ArsRegistrationVacant([string]$desktop,[string]$programs) {
 foreach ($entry in (Get-ArsRegistrationPaths $desktop $programs)) {
  $parent=Split-Path -Parent $entry.path
  $leaf=Split-Path -Leaf $entry.path
  if (@(Get-ChildItem -LiteralPath $parent -Force -ErrorAction Stop|Where-Object Name -eq $leaf).Count) {throw 'Existing shortcut retained; setup blocked.'}
 }
}
function Get-ArsDesktopRegistration([string]$project,[string]$desktop,[string]$programs) {
 Assert-ArsPlainPath $project
 $target=Join-Path $env:WINDIR 'System32\wscript.exe'
 $icon=Join-Path $project 'public\ars-desktop.ico'
 Assert-ArsPlainPath $target
 Assert-ArsPlainPath $icon
 $shell=New-Object -ComObject WScript.Shell
 $files=[ordered]@{}
 try {
  foreach ($entry in (Get-ArsRegistrationPaths $desktop $programs)) {
   $path=$entry.path
   Assert-ArsPlainPath $path
   $item=Get-Item -LiteralPath $path -Force
   if ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 65536) {throw 'Invalid shortcut file.'}
   $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
   $launcher=Join-Path $project $entry.launcher
   Assert-ArsPlainPath $launcher
   $link=$shell.CreateShortcut($path)
   try {
    if ($link.TargetPath -ine $target -or $link.Arguments -cne ('"'+$launcher+'"') -or $link.WorkingDirectory -ine $project -or ($link.IconLocation -replace ',\s*0$',',0') -ine ($icon+',0')) {throw 'Shortcut destination or arguments changed.'}
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $hash) {throw 'Shortcut changed during review.'}
    $files[$path]=[ordered]@{sha256=$hash;launcher=$launcher;target=$target;workingDirectory=$project;icon=$icon}
   } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($link)}
  }
 } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}
 [ordered]@{schema=1;kind='windows-desktop-registration-observation';installation=$project;desktopSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;files=$files;shortcutRemovalAllowed=$false;serviceRemovalAllowed=$false;applicationRemovalAllowed=$false}
}
function Write-ArsDesktopRegistration([string]$project,[string]$state,[string]$desktop,[string]$programs) {
 Assert-ArsPlainPath $state
 $record=Get-ArsDesktopRegistration $project $desktop $programs
 $json=$record|ConvertTo-Json -Depth 8 -Compress
 if (((Get-ArsDesktopRegistration $project $desktop $programs)|ConvertTo-Json -Depth 8 -Compress) -cne $json) {throw 'Registration changed.'}
 $stream=[IO.File]::Open((Join-Path $state 'desktop-registration.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try {$bytes=[Text.Encoding]::UTF8.GetBytes($json);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
}
function Review-ArsDesktopRegistration([string]$project,[string]$state,[string]$desktop,[string]$programs) {
 $path=Join-Path $state 'desktop-registration.json'
 Assert-ArsPlainPath $path
 if ((Get-Item -LiteralPath $path).Length -gt 65536) {throw 'Invalid registration evidence size.'}
 $raw=Get-Content -LiteralPath $path -Raw -Encoding UTF8
 $observed=Get-ArsDesktopRegistration $project $desktop $programs
 if (($observed|ConvertTo-Json -Depth 8 -Compress) -cne $raw -or (Get-Content -LiteralPath $path -Raw -Encoding UTF8) -cne $raw) {throw 'Recorded desktop registration differs.'}
 [ordered]@{registrationMatched=$true;shortcutRemovalAllowed=$false;serviceRemovalAllowed=$false;applicationRemovalAllowed=$false}
}
