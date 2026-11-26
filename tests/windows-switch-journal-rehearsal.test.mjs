import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const script=fileURLToPath(new URL('../scripts/rehearse-windows-switch-journal.ps1',import.meta.url));
test('switch journal rehearsal is disposable',()=>{
 const s=readFileSync(script,'utf8');
 assert.match(s,/GetTempPath/);
 assert.match(s,/previousJournalDigest/);
 assert.doesNotMatch(s,/LOCALAPPDATA|ARS_RUNTIME_ROOT|Start-Process|docker/);
});
test('native switch journal retains chain across success and rollback',{skip:process.platform!=='win32'},()=>{
 for(const rollback of [false,true]){
  const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',script];
  if(rollback)args.push('-Rollback');
  const r=JSON.parse(execFileSync('powershell.exe',args,{encoding:'utf8',timeout:30000}));
  assert.equal(r.phase,rollback?'rolled-back':'completed');
  assert.equal(r.sequence,rollback?4:3);
  assert.equal(r.historyVerified,true);
  assert.equal(r.interruptedSwitchDetected,true);
  assert.equal(r.startupAllowed,false);
 }
});
