import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localConnectionConfig,offlineRecoveryDiagnostics} from '../scripts/writer-loss-offline-diagnostics.mjs';
test('offline diagnostics restrict database targets and require read-only options',()=>{
 const options=localConnectionConfig('postgresql://ars:fixture@127.0.0.1:5434/hardware_pos_ars');
 assert.match(options.options,/default_transaction_read_only=on/);
 for(const url of ['postgresql://ars:p@remote:5434/hardware_pos_ars','postgresql://ars:p@localhost:5432/hardware_pos','postgresql://ars:p@localhost:5433/hardware_pos_ci','postgresql://ars:p@localhost:5433/hardware_pos?sslmode=require'])assert.throws(()=>localConnectionConfig(url));
});
test('offline diagnostics without incident or trusted identity never opens database connection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ars-offline-'));
 try{
  assert.equal((await offlineRecoveryDiagnostics(root,{})).state,'no-incident-record');
  await writeFile(join(root,'.ars-writer-loss.json'),JSON.stringify({schema:1,reason:'writer-lease-lost',pid:123,recordedAt:'2026-01-01T00:00:00Z',reconciliationRequired:true}));
  const result=await offlineRecoveryDiagnostics(root,{});
  assert.equal(result.state,'offline-diagnostics-unavailable');
  assert.equal(result.startupAllowed,false);
  assert.equal(result.recoveryAllowed,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
