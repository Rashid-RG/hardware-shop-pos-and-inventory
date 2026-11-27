# Opt-in current-user one-shot continuation. No elevated execution or stored consent.
function Get-ArsResumePath {
 $folder=[Environment]::GetFolderPath('Startup')
 if (-not $folder -or -not (Test-Path -LiteralPath $folder -PathType Container)) { throw 'Startup folder unavailable.' }
 $cursor=$folder
 while ($cursor) {
  if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked Startup folder is unsupported.' }
  $cursor=Split-Path -Parent $cursor
 }
 Join-Path $folder 'RS Nextward ARS Setup Continuation.lnk'
}
function Get-ArsResumeArguments {
 '"'+(Join-Path $root 'Setup-ARS-Distributor.vbs')+'"'
}
function Consume-ArsSetupResume {
 $path=Get-ArsResumePath
 if (-not (Test-Path -LiteralPath $path)) { return }
 if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected setup continuation link.' }
 $shell=New-Object -ComObject WScript.Shell
 $link=$shell.CreateShortcut($path)
 if ($link.TargetPath -ine (Join-Path $env:WINDIR 'System32\wscript.exe') -or $link.Arguments -cne (Get-ArsResumeArguments) -or $link.WorkingDirectory -ine $root) { throw 'Another setup continuation exists. Contact support.' }
 Remove-Item -LiteralPath $path
}
function Offer-ArsSetupResume {
 if ([System.Windows.Forms.MessageBox]::Show('Reopen RS Nextward Setup once at the next Windows sign-in? Setup will check all requirements again. No administrator approval or agreement acceptance will be retained.',$title,'YesNo','Question') -ne 'Yes') { return }
 $path=Get-ArsResumePath
 if (Test-Path -LiteralPath $path) { throw 'Setup continuation already exists.' }
 $shell=New-Object -ComObject WScript.Shell
 $link=$shell.CreateShortcut($path)
 $link.TargetPath=Join-Path $env:WINDIR 'System32\wscript.exe'
 $link.Arguments=Get-ArsResumeArguments
 $link.WorkingDirectory=$root
 $link.Description='RS Nextward one-time setup continuation'
 $link.Save()
}
