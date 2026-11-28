# External runtime is explicit and must already exist. Legacy paths remain the default.
function Get-ArsWindowsRuntimeRoot([string]$ProjectRoot) {
  $project=[IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
  $override=[Environment]::GetEnvironmentVariable('ARS_RUNTIME_ROOT','Process')
  if ($null -eq $override) { return $project }
  if ([string]::IsNullOrWhiteSpace($override) -or $override -notmatch '^[A-Za-z]:[\\/]') { throw 'ARS_RUNTIME_ROOT must be an absolute local Windows directory.' }
  $runtime=[IO.Path]::GetFullPath($override).TrimEnd('\')
  if ($runtime -ieq $project -or $runtime.StartsWith($project+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'External runtime must be outside the application release.' }
  $cursor=$runtime
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid external runtime directory or ancestor.' }
    $cursor=Split-Path -Parent $cursor
  }
  foreach ($name in @('.env.local','uploads','backups')) {
    $item=Get-Item -LiteralPath (Join-Path $runtime $name) -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($item.PSIsContainer -ne ($name -ne '.env.local'))) { throw 'Invalid external runtime member.' }
  }
  return $runtime
}
