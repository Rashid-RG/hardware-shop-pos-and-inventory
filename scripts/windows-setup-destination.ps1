# Copy verified package files only, into a new local user-selected destination.
function Assert-ArsPlainPath([string]$path) {
 $cursor=$path
 while ($cursor) {
  $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation paths are unsupported.' }
  $cursor=Split-Path -Parent $cursor
 }
}
function Copy-ArsPilotRelease([string]$source,[string]$destination) {
 $source=[IO.Path]::GetFullPath($source).TrimEnd('\')
 $destination=[IO.Path]::GetFullPath($destination).TrimEnd('\')
 if ($source -notmatch '^[A-Za-z]:\\' -or $destination -notmatch '^[A-Za-z]:\\') { throw 'Choose a local installation folder.' }
 if ($destination -ieq $source -or $destination.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase) -or $source.StartsWith($destination+'\',[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $destination)) { throw 'Installation folder must be new and separate from the downloaded package.' }
 Assert-ArsPlainPath $source
 Assert-ArsPlainPath (Split-Path -Parent $destination)
 $manifestPath=Join-Path $source 'PILOT-FILES.json'
 Assert-ArsPlainPath $manifestPath
 $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
 $records=@($manifest.PSObject.Properties)
 foreach ($required in @('package.json','package-lock.json','scripts/setup-wizard.ps1','Launch-Hardware-POS.vbs','PILOT-RELEASE.json')) {
  if ($required -cnotin $records.Name) { throw 'Required package file missing.' }
 }
 $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
 foreach ($record in $records) {
  $name=$record.Name
  if ($name -match '[\\:*?"<>|\x00-\x1f]' -or $name.StartsWith('/') -or $name -match '(^|/)(\.{1,2}|\.git|node_modules|dist|uploads|backups|\.env\.local|\.ars-node-runtime)(/|$)' -or $name -match '(^|/)[^/]*[. ](/|$)' -or $name -match '(^|/)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|/|$)' -or $name.Contains('//') -or -not $seen.Add($name)) { throw 'Unsafe or duplicate package path.' }
  if ($record.Value.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid package checksum.' }
  $file=Join-Path $source $name
  Assert-ArsPlainPath $file
  if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $record.Value.sha256) { throw "Package integrity mismatch: $name" }
 }
 # Never overwrite an existing file. Retain incomplete copies on failure.
 New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
 foreach ($record in $records) {
  $target=Join-Path $destination $record.Name
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $target))
  [IO.File]::Copy((Join-Path $source $record.Name),$target,$false)
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $record.Value.sha256) { throw 'Copied file integrity mismatch.' }
 }
 [IO.File]::Copy($manifestPath,(Join-Path $destination 'PILOT-FILES.json'),$false)
}
