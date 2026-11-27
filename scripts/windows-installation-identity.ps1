# Fresh setup identity evidence only. Never grants permission to remove files.
. (Join-Path $PSScriptRoot 'windows-setup-destination.ps1')
function Get-ArsInstallationIdentity([string]$project,[string]$state) {
 $project=[IO.Path]::GetFullPath($project).TrimEnd('\')
 $state=[IO.Path]::GetFullPath($state).TrimEnd('\')
 foreach ($p in @($project,$state)) {Assert-ArsPlainPath $p}
 if ($project -ieq $state -or $project.StartsWith($state+'\',[StringComparison]::OrdinalIgnoreCase) -or $state.StartsWith($project+'\',[StringComparison]::OrdinalIgnoreCase)) {throw 'Installation and state overlap.'}
 $manifestPath=Join-Path $project 'PILOT-FILES.json'
 Assert-ArsPlainPath $manifestPath
 if ((Get-Item -LiteralPath $manifestPath).Length -gt 16777216) {throw 'Manifest too large.'}
 $manifestHash=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
 $manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
 $records=@($manifest.PSObject.Properties)
 foreach ($required in @('package.json','package-lock.json','PILOT-RELEASE.json','scripts/setup-wizard.ps1','Launch-Hardware-POS.vbs')) {
  if ($required -cnotin $records.Name) {throw 'Package provenance missing.'}
 }
 foreach ($record in $records) {
  $name=$record.Name
  if ($name -match '[\\:*?"<>|\x00-\x1f]' -or $name.StartsWith('/') -or $name -match '(^|/)(\.{1,2}|\.git|node_modules|dist|uploads|backups|\.env\.local)(/|$)' -or $name -match '(^|/)[^/]*[. ](/|$)' -or $name.Contains('//')) {throw 'Unsafe package path.'}
  $file=Join-Path $project $name
  Assert-ArsPlainPath $file
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $record.Value.sha256) {throw 'Package file changed.'}
 }
 foreach ($name in @('dist/server.cjs','dist/index.html')) {Assert-ArsPlainPath (Join-Path $project $name)}
 $queue=New-Object 'System.Collections.Generic.Queue[string]'
 $queue.Enqueue($project)
 $entries=New-Object 'System.Collections.Generic.List[string]'
 while ($queue.Count) {
  foreach ($item in Get-ChildItem -LiteralPath ($queue.Dequeue()) -Force -ErrorAction Stop) {
   $relative=$item.FullName.Substring($project.Length+1).Replace('\','/')
   # Runtime contents are excluded, not claimed as owned application files.
   if ($relative -in @('.env.local','uploads','backups')) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Unexpected runtime link.'}
    continue
   }
   if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint -or $relative -match '[\r\n\t]') {throw 'Unsupported application entry.'}
   if ($entries.Count -ge 200000) {throw 'Installation exceeds identity limit.'}
   if ($item.PSIsContainer) {$entries.Add('D|'+$relative);$queue.Enqueue($item.FullName)}
   else {$entries.Add('F|'+$relative+'|'+$item.Length+'|'+(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash)}
  }
 }
 $lines=$entries.ToArray()
 [Array]::Sort($lines,[StringComparer]::Ordinal)
 $sha=[Security.Cryptography.SHA256]::Create()
 try {$digest=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines -join [char]10)))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
 if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -cne $manifestHash) {throw 'Manifest changed.'}
 [ordered]@{schema=1;kind='windows-installation-identity-observation';installation=$project;desktopSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;packageManifestDigest=$manifestHash;applicationTreeDigest=$digest;entryCount=$lines.Length;runtimeExcluded=$true;installationOwnershipCertified=$false;applicationRemovalAllowed=$false;serviceRemovalAllowed=$false;databaseDeletionAllowed=$false}
}
function Write-ArsInstallationIdentity([string]$project,[string]$state) {
 $target=Join-Path $state 'installation-identity.json'
 $record=Get-ArsInstallationIdentity $project $state
 if (((Get-ArsInstallationIdentity $project $state)|ConvertTo-Json -Compress) -cne ($record|ConvertTo-Json -Compress)) {throw 'Installation changed.'}
 $stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try {$bytes=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Compress));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
}
function Review-ArsInstallationIdentity([string]$project,[string]$state) {
 $target=Join-Path $state 'installation-identity.json'
 Assert-ArsPlainPath $target
 if ((Get-Item -LiteralPath $target).Length -gt 65536) {throw 'Invalid identity evidence size.'}
 $raw=Get-Content -LiteralPath $target -Raw
 $observed=Get-ArsInstallationIdentity $project $state
 if (($observed|ConvertTo-Json -Compress) -cne $raw -or (Get-Content -LiteralPath $target -Raw) -cne $raw) {throw 'Recorded installation identity differs.'}
 [ordered]@{installationIdentityMatched=$true;installationOwnershipCertified=$false;applicationRemovalAllowed=$false}
}
