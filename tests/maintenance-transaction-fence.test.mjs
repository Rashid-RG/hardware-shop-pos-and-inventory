import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acquireMaintenanceTransactionFence} from '../scripts/database-handoff-gate.mjs';
const read=p=>readFileSync(new URL('../scripts/'+p,import.meta.url),'utf8');
test('maintenance wrappers retain exclusive transaction fence before table locks',()=>{
 const windows=read('windows-locked-maintenance-backup.mjs');
 const session=read('database-maintenance-session.mjs');
 const fence=read('database-maintenance-table-fence.mjs');
 const mint=read('mint/locked-backup.mjs');
 for(const s of [windows,session]){
  const gate=s.indexOf('await acquireHandoffGate(client)');
  const writer=s.indexOf('pg_try_advisory_lock');
  const transaction=s.indexOf('await acquireMaintenanceTransactionFence(client)');
  assert.ok(gate>=0&&writer>gate&&transaction>writer);
  assert.match(s,/await client\.end\(\)/);
 }
 assert.ok(windows.indexOf('await acquireMaintenanceTransactionFence(client)')<windows.indexOf("await client.query('BEGIN')"));
 assert.match(mint,/withMaintenanceSession\(client,'hardware_pos_ars',session=>withMaintenanceTableFence\(client,session,/);
 assert.ok(session.indexOf('await acquireMaintenanceTransactionFence(client)')<session.indexOf('await work('));
 const verify=fence.indexOf('await verify()');
 const begin=fence.indexOf("await client.query('BEGIN')");
 const lock=fence.indexOf("await client.query('LOCK TABLE");
 assert.ok(verify>=0&&begin>verify&&lock>begin);
 assert.match(fence,/IN SHARE MODE NOWAIT/);
});
test('maintenance fence rejects outstanding transactions',async()=>{
 await assert.rejects(acquireMaintenanceTransactionFence({query:async(sql,keys)=>{assert.deepEqual(keys,[1642958133,3]);return {rows:[{acquired:false}]};}}),/Outstanding fenced transaction/);
});
