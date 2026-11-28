import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectRecoveryBusinessRecords,recoveryChecks} from '../scripts/writer-loss-business-reconciliation.mjs';
const expected={database:'hardware_pos_ci',systemIdentifier:'123',databaseOid:'456'};
function fixture({mismatch=false,exception=false,fail=false}={}){
 const calls=[];
 return {calls,query:async sql=>{
 calls.push(sql);
 if(sql.includes('pg_control_system()'))return {rows:[{database:expected.database,system_identifier:mismatch?'999':'123',database_oid:'456',read_only:true,snapshot:true}]};
 if(sql===recoveryChecks.unbalancedJournals&&fail)throw Error('Missing table');
 if(Object.values(recoveryChecks).includes(sql))return {rows:[{n:exception&&sql===recoveryChecks.unbalancedJournals?'2':'0'}]};
 return {rows:[]};
 }};
}
test('structural recovery checks use one read-only snapshot and never grant clearance',async()=>{
 for(const [options,state] of [[{},'structural-checks-matched'],[{exception:true},'exceptions-detected'],[{mismatch:true},'reconciliation-unavailable'],[{fail:true},'reconciliation-unavailable']]){
 const c=fixture(options);
 const r=await inspectRecoveryBusinessRecords(c,expected);
 assert.equal(r.state,state);
 assert.equal(r.accountingVerified,false);
 assert.equal(r.recoveryAllowed,false);
 assert.equal(c.calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(c.calls.at(-1),'ROLLBACK');
 assert.ok(!c.calls.some(s=>/^(INSERT|UPDATE|DELETE|COMMIT|CREATE|ALTER|DROP)\b/.test(s)));
 }
});
