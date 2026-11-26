import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../scripts/rehearse-windows-runtime-pointer.ps1',import.meta.url));
test('runtime pointer rehearsal is restricted to disposable fixture',()=>{
 const s=readFileSync(path,'utf8');
 assert.match(s,/\[IO.Path\]::GetTempPath/);
 assert.match(s,/\[IO.File\]::Replace/);
 assert.doesNotMatch(s,/LOCALAPPDATA|ARS_RUNTIME_ROOT|Start-Process|docker/);
});
test('native Windows atomic replacement and rollback',{skip:process.platform!=='win32'},()=>{
 const result=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path],{encoding:'utf8',timeout:30000}));
 for(const k of ['candidateSwitchRehearsed','rollbackRehearsed','stalePointerRejected','runtimePreserved'])assert.equal(result[k],true);
 assert.equal(result.activationAllowed,false);
 assert.equal(result.startupAllowed,false);
});
