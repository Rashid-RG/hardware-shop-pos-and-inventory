param(
  [Parameter(Mandatory = $true)]
  [string]$Url,
  [string]$ShortcutName = 'ARS Hardware POS'
)

$ErrorActionPreference = 'Stop'
try {
  $parsedUrl = [Uri]$Url
} catch {
  throw 'Enter the hosted ARS web address, including https://.'
}

if (-not $parsedUrl.IsAbsoluteUri -or $parsedUrl.Scheme -ne 'https' -or
    -not $parsedUrl.Host -or $parsedUrl.UserInfo -or $parsedUrl.Fragment) {
  throw 'For hosted ARS, use an HTTPS URL without credentials or fragments.'
}

if ($ShortcutName -notmatch '^[a-zA-Z0-9 _-]{1,70}$') {
  throw 'The shortcut name can only contain letters, numbers, spaces, underscore and hyphen.'
}

$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop) { throw 'Cannot find the Windows Desktop folder.' }

$shortcutPath = Join-Path $desktop ($ShortcutName + '.url')
if (Test-Path -LiteralPath $shortcutPath) {
  throw "Shortcut already exists: $shortcutPath. No existing file has been overwritten."
}

# URL shortcuts use Windows' default browser and do not install a local database,
# Node.js, Docker, or a background task on the employee computer.
$target = $parsedUrl.GetLeftPart([System.UriPartial]::Path) + $parsedUrl.Query
$shortcutText = "[InternetShortcut]`r`nURL=$target`r`n"
[System.IO.File]::WriteAllText($shortcutPath, $shortcutText, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "ARS shortcut created: $shortcutPath"
Write-Host 'Daily use: Double-click the shortcut, sign in, and begin work.'
Write-Host 'At closing time: finish shift checks, sign out, then shut down Windows normally.'
