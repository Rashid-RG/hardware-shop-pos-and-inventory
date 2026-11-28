import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectRecoveryDatabase} from '../scripts/writer-loss-database-inspection.mjs';
const expected={database:'hardware_pos_ci',systemIdentifier:'1234567890123456789',databaseOid:'12345'};
const identity={database:expected.database,system_identifier:expected.systemIdentifier,database_oid:expected.databaseOid,read_only:true,full_visibility:true};
const mock=(row=identity,activity={other_sessions:0,prepared_transactions:0,application_locks:0})=>({query:async sql=>({rows:[sql.includes('pg_control_system')?row:activity]})});
test('database inspection distinguishes identity, visibility and actual activity',async()=>{
 assert.equal((await inspectRecoveryDatabase(mock({...identity,database_oid:'99'}),expected)).state,'identity-or-readonly-mismatch');
 assert.equal((await inspectRecoveryDatabase(mock({...identity,read_only:false}),expected)).state,'identity-or-readonly-mismatch');
 assert.equal((await inspectRecoveryDatabase(mock({...identity,full_visibility:false}),expected)).state,'insufficient-visibility');
 for(const key of ['other_sessions','prepared_transactions','application_locks']){
  const result=await inspectRecoveryDatabase(mock(identity,{other_sessions:0,prepared_transactions:0,application_locks:0,[key]:1}),expected);
  assert.equal(result.state,'activity-detected');
 }
 const result=await inspectRecoveryDatabase(mock(),expected);
 assert.equal(result.state,'no-activity-observed');
 assert.equal(result.continuousExclusionVerified,false);
 assert.equal(result.startupAllowed,false);
 assert.equal(result.recoveryAllowed,false);
});
