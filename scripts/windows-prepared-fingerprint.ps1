# Local prepared-release integrity record. Not a substitute for a signed release or trusted build.
function Get-ArsPreparedFingerprint([string]$Root) {
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if ((Get-Item -LiteralPath $rootPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Prepared root is a reparse point.' }
  $queue = New-Object 'System.Collections.Generic.Queue[string]'
  $queue.Enqueue($rootPath)
  $records = New-Object 'System.Collections.Generic.List[string]'
  while ($queue.Count) {
    foreach ($item in Get-ChildItem -LiteralPath ($queue.Dequeue()) -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Prepared release contains a reparse point.' }
      $relative = $item.FullName.Substring($rootPath.Length+1).Replace('\','/')
      if ($relative -match '[\r\n\t]') { throw 'Invalid fingerprint path.' }
      if ($relative -ceq '.ars-prepared-fingerprint.json') { if ($item.PSIsContainer) { throw 'Invalid fingerprint record.' }; continue }
      if ($item.PSIsContainer) { $queue.Enqueue($item.FullName); continue }
      if ($records.Count -ge 200000) { throw 'Prepared release exceeds fingerprint file limit.' }
      $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      $records.Add("$relative`t$($item.Length)`t$hash")
    }
  }
  $lines = $records.ToArray()
  [Array]::Sort($lines,[StringComparer]::Ordinal)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines -join "`n")))).Replace('-','').ToLowerInvariant()
  } finally { $sha.Dispose() }
  [pscustomobject]@{schema=1;algorithm='sha256';files=$lines.Length;digest=$digest}
}
function Assert-ArsPreparedFingerprint([string]$Root) {
  $path = Join-Path $Root '.ars-prepared-fingerprint.json'
  $item = Get-Item -LiteralPath $path -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 4096) { throw 'Invalid prepared fingerprint record.' }
  $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $actual = Get-ArsPreparedFingerprint $Root
  if ($record.schema -ne 1 -or $record.algorithm -cne 'sha256' -or $record.files -ne $actual.files -or $record.digest -cne $actual.digest) { throw 'Prepared release fingerprint mismatch. Do not activate.' }
  return $actual
}

# Recovery script integrity observation, separate from prepared-build evidence.
function Get-ArsRecoveryToolsFingerprint([string]$Root) {
  $rootPath=[IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $cursor=$rootPath
  while ($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Invalid recovery directory.'}
    $cursor=Split-Path -Parent $cursor
  }
  $queue=New-Object 'System.Collections.Generic.Queue[string]'
  $queue.Enqueue($rootPath)
  $records=New-Object 'System.Collections.Generic.List[string]'
  while ($queue.Count) {
    foreach ($item in Get-ChildItem -LiteralPath ($queue.Dequeue()) -Force -ErrorAction Stop) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Recovery tools contain a reparse point.'}
      $relative=$item.FullName.Substring($rootPath.Length+1).Replace('\','/')
      if ($relative -match '[\r\n\t]' -or $records.Count -ge 200000) {throw 'Invalid recovery inventory.'}
      if ($item.PSIsContainer) {
        if ($item.Name -ceq '__pycache__') {continue}
        $records.Add("D	$relative")
        $queue.Enqueue($item.FullName)
        continue
      }
      if ($item.Extension -in @('.pyc','.pyo')) {throw 'Unexpected standalone bytecode.'}
      $stream=[IO.File]::Open($item.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
      $sha=[Security.Cryptography.SHA256]::Create()
      try {
        $length=$stream.Length
        $hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()
        $after=Get-Item -LiteralPath $item.FullName -Force -ErrorAction Stop
        if ($length -ne $item.Length -or $after.Length -ne $length -or $after.LastWriteTimeUtc -ne $item.LastWriteTimeUtc -or ($after.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Recovery file changed.'}
        $records.Add("F	$relative	$length	$hash")
      } finally {$sha.Dispose();$stream.Dispose()}
    }
  }
  $lines=$records.ToArray()
  [Array]::Sort($lines,[StringComparer]::Ordinal)
  $sha=[Security.Cryptography.SHA256]::Create()
  try {
    $digest=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(("ars-recovery-tools-v1"+[char]10+($lines -join [char]10))))).Replace('-','').ToLowerInvariant()
    return $digest
  } finally {$sha.Dispose()}
}
