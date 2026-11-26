import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../backend/maintenanceStartupGuard.ts',import.meta.url),'utf8');
const compiled=transformSync(source,{loader:'ts',format:'esm'}).code;
const {assertNoWriterLoss,recordWriterLoss}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('writer incident evidence persists and is never overwritten',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ars-writer-loss-'));
 try{
  assert.doesNotThrow(()=>assertNoWriterLoss(dir));
  recordWriterLoss(dir);
  const file=join(dir,'.ars-writer-loss.json');
  const original=readFileSync(file,'utf8');
  assert.equal(JSON.parse(original).reconciliationRequired,true);
  recordWriterLoss(dir);
  assert.equal(readFileSync(file,'utf8'),original);
  assert.throws(()=>assertNoWriterLoss(dir),/Startup blocked/);
  writeFileSync(file,'{');
  assert.throws(()=>assertNoWriterLoss(dir),/Startup blocked/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
