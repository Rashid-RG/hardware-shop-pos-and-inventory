import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMaintenanceClusterIdentity,assertMaintenanceClusterMatch,readProtectedMaintenanceClusterIdentity} from '../scripts/maintenance-cluster-identity.mjs';
const row=(database='hardware_pos')=>({database,system_identifier:'18446744073709551615',database_oid:'4294967295'});
function fixture(database='hardware_pos'){
 const controller=new AbortController();
 let checks=0,queries=0;
 const scope={owner:{database,databaseOid:row(database).database_oid},signal:controller.signal,assertActive:async()=>{checks++;}};
 const client={query:async sql=>{queries++;assert.match(sql,/pg_control_system\(\)/);assert.match(sql,/system_identifier::text/);return {rows:[row(database)]};}};
 return {controller,scope,client,checks:()=>checks,queries:()=>queries,read:()=>readProtectedMaintenanceClusterIdentity(client,scope)};
}
test('both managed database identities preserve full integer precision',async()=>{
 for(const database of ['hardware_pos','hardware_pos_ars']){
  const f=fixture(database),identity=await f.read();
  assert.deepEqual(identity,{database,systemIdentifier:'18446744073709551615',databaseOid:'4294967295'});
  assert.ok(Object.isFrozen(identity));assert.equal(f.checks(),2);assert.equal(f.queries(),1);
  assertMaintenanceClusterMatch(identity,normalizeMaintenanceClusterIdentity(row(database),database));
 }
});
test('invalid cluster identifiers and database OIDs fail closed',()=>{
 for(const v of [undefined,null,0,1,'0','01','-1','1.0',' 1','18446744073709551616','1e9']){
  assert.throws(()=>normalizeMaintenanceClusterIdentity({...row(),system_identifier:v},'hardware_pos'),/Invalid maintenance cluster identity/);
 }
 for(const v of [undefined,null,1,'0','01','4294967296','-1','1.1']){
  assert.throws(()=>normalizeMaintenanceClusterIdentity({...row(),database_oid:v},'hardware_pos'),/Invalid maintenance cluster identity/);
 }
 assert.throws(()=>normalizeMaintenanceClusterIdentity(row('hardware_pos_ci'),'hardware_pos_ci'),/Invalid maintenance cluster identity/);
 assert.throws(()=>normalizeMaintenanceClusterIdentity(row(),'hardware_pos_ars'),/Invalid maintenance cluster identity/);
});
test('cluster comparison rejects a different cluster or database',()=>{
 const expected=normalizeMaintenanceClusterIdentity(row(),'hardware_pos');
 for(const patch of [{database:'hardware_pos_ars'},{systemIdentifier:'1'},{databaseOid:'1'}]){
  assert.throws(()=>assertMaintenanceClusterMatch(expected,{...expected,...patch}),/PostgreSQL cluster identity mismatch/);
 }
 assert.throws(()=>assertMaintenanceClusterMatch(expected,null),/PostgreSQL cluster identity mismatch/);
});
test('identity reader rejects missing or duplicate rows and wrong session database OID',async()=>{
 for(const rows of [[],[row(),row()]]){
  const f=fixture();f.client.query=async()=>({rows});
  await assert.rejects(f.read(),/Unique maintenance cluster identity required/);
 }
 const f=fixture();f.scope.owner.databaseOid='123';
 await assert.rejects(f.read(),/Protected database identity mismatch/);
});
test('identity reader refuses cancelled or lost protection and propagates permission errors',async()=>{
 const f=fixture();f.controller.abort();await assert.rejects(f.read(),/Maintenance interrupted/);assert.equal(f.queries(),0);
 const g=fixture();g.client.query=async()=>{g.controller.abort();return {rows:[row()]};};await assert.rejects(g.read(),/Maintenance interrupted/);
 const h=fixture();h.scope.assertActive=async()=>{throw Error('Fixture protection lost');};await assert.rejects(h.read(),/Fixture protection lost/);assert.equal(h.queries(),0);
 const p=fixture();p.client.query=async()=>{throw Object.assign(Error('permission denied'),{code:'42501'});};await assert.rejects(p.read(),{code:'42501'});
 const c=fixture('hardware_pos_ci');await assert.rejects(c.read(),/Protected cluster identity scope required/);assert.equal(c.queries(),0);
});
