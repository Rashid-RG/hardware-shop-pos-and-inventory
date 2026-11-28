Option Explicit
Dim shell, fso, root, script, ps, result
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(root, "scripts\sign-native-installers-wizard.ps1")
If Not fso.FileExists(script) Then
  MsgBox "Signing wizard missing. Extract the complete RS Nextward signing toolkit first.", vbCritical, "RS Nextward"
  WScript.Quit 1
End If
ps = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
result = shell.Run("""" & ps & """ -NoProfile -STA -ExecutionPolicy RemoteSigned -File """ & script & """", 1, True)
WScript.Quit result
