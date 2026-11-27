# Build Windows-specific payload from the validated pilot ZIP. No installation.
param([Parameter(Mandatory=$true)][string]$SourceZip,[Parameter(Mandatory=$true)][string]$OutputZip)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {throw 'Hosted packaging runner required.'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source=(Get-Item -LiteralPath $SourceZip).FullName
$output=[IO.Path]::GetFullPath($OutputZip)
if (Test-Path -LiteralPath $output) {throw 'Output already exists.'}
$temp=Join-Path $env:RUNNER_TEMP ('ars-native-payload-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($temp)
try {
 $binary=Join-Path $temp 'maintenance-supervisor.exe'
 $compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
 $sources=@('windows-maintenance-job.cs','windows-maintenance-suspended-worker.cs','windows-maintenance-cancellation-bridge.cs','windows-maintenance-supervisor.cs') | ForEach-Object {Join-Path $PSScriptRoot $_}
 & $compiler /nologo /target:exe /optimize+ "/out:$binary" @sources
 if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $binary -PathType Leaf)) {throw 'Supervisor compilation failed.'}
 [IO.File]::Copy($source,$output,$false)
 $archive=[IO.Compression.ZipFile]::Open($output,[IO.Compression.ZipArchiveMode]::Update)
 try {
  $prefix='ARS-Distributor/'
  $relative='installer-runtime/maintenance-supervisor.exe'
  $manifest=$archive.GetEntry($prefix+'PILOT-FILES.json')
  if (-not $manifest -or $archive.GetEntry($prefix+$relative)) {throw 'Unexpected payload entries.'}
  $reader=New-Object IO.StreamReader($manifest.Open())
  try {$records=$reader.ReadToEnd() | ConvertFrom-Json} finally {$reader.Dispose()}
  if ($records.PSObject.Properties[$relative]) {throw 'Duplicate supervisor manifest record.'}
  $hash=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
  $records | Add-Member -NotePropertyName $relative -NotePropertyValue ([ordered]@{sha256=$hash;mode=420})
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$binary,($prefix+$relative))
  $manifest.Delete()
  $entry=$archive.CreateEntry($prefix+'PILOT-FILES.json')
  $writer=New-Object IO.StreamWriter($entry.Open(),(New-Object Text.UTF8Encoding($false)))
  try {$writer.Write(($records | ConvertTo-Json -Depth 5 -Compress))} finally {$writer.Dispose()}
 } finally {$archive.Dispose()}
 $check=[IO.Compression.ZipFile]::OpenRead($output)
 try {
  $entry=$check.GetEntry($prefix+$relative)
  $stream=$entry.Open()
  $sha=[Security.Cryptography.SHA256]::Create()
  try {$actual=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose();$stream.Dispose()}
  if ($actual -cne $hash) {throw 'Embedded supervisor checksum mismatch.'}
 } finally {$check.Dispose()}
} finally {Remove-Item -LiteralPath $temp -Recurse -Force}
