import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('../scripts/windows-switch-inspection.ps1',import.meta.url));
test('stable launcher blocks unresolved switch evidence',()=>{
 const s=readFileSync(new URL('../scripts/preview-windows-stable-launcher.ps1',import.meta.url),'utf8');
 assert.match(s,/Get-ArsSwitchInspection \$control/);
 assert.match(s,/state -cne 'no-switch-evidence'/);
 assert.match(readFileSync(new URL('../scripts/prepare-windows-stable-launcher.ps1',import.meta.url),'utf8'),/windows-switch-inspection\.ps1/);
});
test('native Windows switch inspection rejects incomplete and conflicting evidence',{skip:process.platform!=='win32'},()=>{
 const root=mkdtempSync(join(tmpdir(),'ars-switch-inspection-'));
 try{
  const run=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',". '"+helper.replaceAll("'","''")+"'; Get-ArsSwitchInspection '"+root.replaceAll("'","''")+"' | ConvertTo-Json"],{encoding:'utf8',timeout:15000}));
  assert.equal(run().state,'no-switch-evidence');
  const journal={schema:1,switchId:'a'.repeat(32),previousDigest:'b'.repeat(64),candidateDigest:'c'.repeat(64),phase:'switched',activationAllowed:false};
  writeFileSync(join(root,'runtime-switch-journal.json'),JSON.stringify(journal));
  assert.equal(run().state,'incomplete-switch-evidence');
  const pointer={schema:1,switchId:journal.switchId,digest:journal.previousDigest,activationAllowed:false};
  writeFileSync(join(root,'runtime-active.json'),JSON.stringify(pointer));
  assert.equal(run().state,'pointer-conflict');
  pointer.digest=journal.candidateDigest;
  writeFileSync(join(root,'runtime-active.json'),JSON.stringify(pointer));
  const result=run();assert.equal(result.state,'switch-review-required');assert.equal(result.startupAllowed,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
