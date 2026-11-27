Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-wizard.ps1", 1, True
