import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectRecoveryReconciliation} from '../scripts/writer-loss-reconciliation-summary.mjs';
test('wrong identity invalidates the entire snapshot',async()=>{
 const calls=[];
 const c={query:async sql=>{calls.push(sql);return {rows:[]};}};
 const r=await inspectRecoveryReconciliation(c,{database:'hardware_pos_ci',systemIdentifier:'1',databaseOid:'2'});
 assert.equal(r.consistentAcrossSections,false);
 assert.equal(r.recoveryAllowed,false);
 assert.ok(Object.values(r.sections).every(s=>s==='unavailable'));
 assert.equal(calls.at(-1),'ROLLBACK');
});
test('shared snapshot isolates section errors without independent transactions',async()=>{
 const calls=[];
 const c={query:async sql=>{calls.push(sql);if(sql.includes('pg_control_system()'))return {rows:[{database:'hardware_pos_ci',system_identifier:'1',database_oid:'2',read_only:true,snapshot:true}]};if(sql.startsWith('SELECT')||sql.startsWith('WITH'))throw Error('Missing fixture tables');return {rows:[]};}};
 const r=await inspectRecoveryReconciliation(c,{database:'hardware_pos_ci',systemIdentifier:'1',databaseOid:'2'});
 assert.equal(r.consistentAcrossSections,true);
 assert.equal(r.allSectionsAvailable,false);
 assert.equal(calls.filter(s=>s.startsWith('BEGIN')).length,1);
 assert.equal(calls.filter(s=>s==='ROLLBACK').length,1);
 assert.ok(calls.includes('ROLLBACK TO SAVEPOINT recovery_section'));
 assert.equal(r.recoveryAllowed,false);
});
