import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../backend/maintenanceStartupGuard.ts',import.meta.url),'utf8');
const compiled=transformSync(source,{loader:'ts',format:'esm'}).code;
const {assertNoMaintenanceEvidence}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('persistent maintenance evidence blocks ordinary startup even when malformed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ars-maintenance-'));
 try{
  const names=['maintenance.json','handoff-pending.json'];
  assert.doesNotThrow(()=>assertNoMaintenanceEvidence(dir,names));
  for(const name of names){
   const marker=join(dir,name);
   writeFileSync(marker,'interrupted partial record');
   assert.throws(()=>assertNoMaintenanceEvidence(dir,names),/Startup blocked/);
   rmSync(marker);
   mkdirSync(marker);
   assert.throws(()=>assertNoMaintenanceEvidence(dir,names),/Startup blocked/);
   rmSync(marker,{recursive:true});
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('startup guard runs under handoff gate before writer lease',()=>{
 const s=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const section=s.slice(s.indexOf('const acquireSingleWriterLease'),s.indexOf('const releaseSingleWriterLease'));
 assert.ok(section.indexOf('assertOrdinaryStartupAllowed()')>section.indexOf('DATABASE_HANDOFF_GATE_ID'));
 assert.ok(section.indexOf('assertOrdinaryStartupAllowed()')<section.indexOf('[SINGLE_WRITER_LOCK_CLASS, SINGLE_WRITER_LOCK_ID]'));
});
