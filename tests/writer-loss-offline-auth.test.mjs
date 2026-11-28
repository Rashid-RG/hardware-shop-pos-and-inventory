import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {globalRecoveryPolicy,verifyOfflineRecoveryPair} from '../scripts/writer-loss-offline-auth.mjs';
test('shop scope fails closed',()=>{
 assert.equal(globalRecoveryPolicy('a@example.com',{}),true);
 assert.equal(globalRecoveryPolicy('a@example.com',{SUPER_ADMIN_ALLOWED_SHOPS:'shop1'}),false);
 assert.equal(globalRecoveryPolicy('A@example.com',{USER_FIXED_SHOPS:'a@example.com=shop1'}),false);
 assert.equal(globalRecoveryPolicy('a@example.com',{USER_FIXED_SHOPS:'malformed'}),false);
});
test('distinct existing global administrator passwords required',async()=>{
 const hash=await bcrypt.hash('test-password',4);
 const expected={database:'hardware_pos_ci',systemIdentifier:'1',databaseOid:'2'};
 const calls=[];
 const client={query:async(sql,params)=>{calls.push(sql);if(sql.includes('pg_control_system()'))return {rows:[{database:expected.database,system_identifier:'1',database_oid:'2',read_only:true,snapshot:true}]};if(sql.includes('FROM users'))return {rows:[{id:params[0],email:params[0],role:'Super Admin',password_hash:hash,revision:'test'}]};return {rows:[]};}};
 const a={email:'a@example.com',password:'test-password'},b={email:'b@example.com',password:'test-password'};
 const r=await verifyOfflineRecoveryPair(client,expected,{},a,b);
 assert.equal(r.state,'distinct-admin-credentials-verified');assert.equal(r.recoveryAllowed,false);assert.equal(r.independenceVerified,false);
 assert.ok(!JSON.stringify(r).includes(hash));assert.equal(calls.at(-1),'ROLLBACK');
 assert.equal((await verifyOfflineRecoveryPair(client,expected,{},a,a)).credentialsVerified,false);
 assert.equal((await verifyOfflineRecoveryPair(client,expected,{},a,{...b,password:'wrong'})).credentialsVerified,false);
 assert.equal((await verifyOfflineRecoveryPair(client,expected,{SUPER_ADMIN_ALLOWED_SHOPS:'s'},a,b)).credentialsVerified,false);
});
