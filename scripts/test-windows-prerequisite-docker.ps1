$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'windows-prerequisites.ps1')

function docker {
 switch ($args[0]) {
  'context' { Set-Variable LASTEXITCODE 0 -Scope 1; return $endpoint }
  'info' { Set-Variable LASTEXITCODE $engineExit -Scope 1; return $engineOS }
  'compose' { Set-Variable LASTEXITCODE $composeExit -Scope 1 }
  default { throw 'Unexpected Docker command.' }
 }
}
$endpoint='npipe:////./pipe/docker_engine'
$engineExit=0
$engineOS='linux'
$composeExit=0
if ((Get-ArsPrerequisitePlan).Docker -ne 'ready') { throw 'Local Linux engine with Compose must be ready.' }
$composeExit=1
if ((Get-ArsPrerequisitePlan).Docker -ne 'unsupported') { throw 'Missing Compose must block setup.' }
$composeExit=0
$engineOS='windows'
if ((Get-ArsPrerequisitePlan).Docker -ne 'unsupported') { throw 'Windows containers must block setup.' }
$engineExit=1
if ((Get-ArsPrerequisitePlan).Docker -ne 'installed') { throw 'An inactive local engine must be reported as installed.' }
$endpoint='ssh://remote.example'
if ((Get-ArsPrerequisitePlan).Docker -ne 'unsupported') { throw 'Remote Docker must block setup.' }
