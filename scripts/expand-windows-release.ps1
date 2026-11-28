# Extract a verified ZIP into a new private directory. Never use this on the active installation.
function Expand-ArsRelease([string]$Archive,[string]$Destination) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $Destination) { throw 'Extraction destination already exists.' }
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    if ($zip.Entries.Count -gt 25000) { throw 'Too many release entries.' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    [long]$total = 0
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName
      $directory = $name.EndsWith('/')
      $parts = $name.TrimEnd('/').Split('/')
      foreach ($part in $parts) {
        if ($part -notmatch '^[a-zA-Z0-9_.@+ -]+$' -or $part -in @('.','..') -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)' -or $part -match '^(?i:\.git|node_modules|uploads|backups|\.env(?:\..*)?)$') { throw 'Unsafe or prohibited release path.' }
      }
      if (-not $seen.Add(($parts -join '/'))) { throw 'Duplicate release path.' }
      $kind = ($entry.ExternalAttributes -shr 16) -band 61440
      if (($kind -ne 0 -and $kind -ne 32768 -and $kind -ne 16384) -or ($entry.ExternalAttributes -band 1024)) { throw 'Unsupported archive entry type.' }
      $total += $entry.Length
      if ($total -gt 536870912 -or ($directory -and $entry.Length -ne 0)) { throw 'Release exceeds extraction limit.' }
    }
    New-Item -ItemType Directory -Path $Destination | Out-Null
    $root = [IO.Path]::GetFullPath($Destination) + [IO.Path]::DirectorySeparatorChar
    foreach ($entry in $zip.Entries) {
      $target = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
      if (-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive entry escapes staging directory.' }
      if ($entry.FullName.EndsWith('/')) { New-Item -ItemType Directory -Path $target -Force | Out-Null; continue }
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
      $inputStream = $entry.Open()
      try {
        $output = [IO.File]::Open($target,[IO.FileMode]::CreateNew)
        try {
          $buffer = New-Object byte[] 65536
          [long]$written = 0
          while (($count = $inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
            $written += $count
            if ($written -gt $entry.Length) { throw 'Archive expanded beyond declared size.' }
            $output.Write($buffer,0,$count)
          }
          if ($written -ne $entry.Length) { throw 'Archive entry length mismatch.' }
        } finally { $output.Dispose() }
      } finally { $inputStream.Dispose() }
    }
  } finally { $zip.Dispose() }
}
