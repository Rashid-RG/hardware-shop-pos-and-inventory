import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acquireMaintenanceTransactionFence} from '../scripts/database-handoff-gate.mjs';
test('maintenance wrappers retain exclusive transaction fence before table locks',()=>{
 for(const path of ['windows-locked-maintenance-backup.mjs','mint/locked-backup.mjs']){
 const s=readFileSync(new URL('../scripts/'+path,import.meta.url),'utf8');
 assert.ok(s.indexOf('await acquireHandoffGate(client)')<s.indexOf('await acquireMaintenanceTransactionFence(client)'));
 assert.ok(s.indexOf('pg_try_advisory_lock')<s.indexOf('await acquireMaintenanceTransactionFence(client)'));
 assert.ok(s.indexOf('await acquireMaintenanceTransactionFence(client)')<s.indexOf("await client.query('BEGIN')"));
 assert.match(s,/await client\.end\(\)/);
 }
});
test('maintenance fence rejects outstanding transactions',async()=>{
 await assert.rejects(acquireMaintenanceTransactionFence({query:async(sql,keys)=>{assert.deepEqual(keys,[1642958133,3]);return {rows:[{acquired:false}]};}}),/Outstanding fenced transaction/);
});
