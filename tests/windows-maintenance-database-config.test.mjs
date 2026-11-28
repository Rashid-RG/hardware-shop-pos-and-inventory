import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveWindowsMaintenanceDatabase as resolve} from '../scripts/windows-maintenance-database-config.mjs';

const legacy={DATABASE_URL:'postgresql://postgres:fixture%40secret@localhost:5433/hardware_pos'};
const pilot={ARS_WINDOWS_PILOT:'1',ARS_WINDOWS_DB_PASSWORD:'fixture@secret',DATABASE_URL:'postgresql://ars:fixture%40secret@127.0.0.1:5433/hardware_pos_ars'};
test('legacy Windows database configuration preserves existing database and container',()=>{
 const config=resolve(legacy);
 assert.equal(config.database,'hardware_pos');
 assert.equal(config.container,'hardware-pos-postgres');
 assert.equal(config.user,'postgres');
 assert.equal(config.pilot,false);
 assert.deepEqual(config.connection,{host:'localhost',port:5433,database:'hardware_pos',user:'postgres',password:'fixture@secret',ssl:false,connectionTimeoutMillis:5000,query_timeout:15000});
 assert.ok(Object.isFrozen(config)&&Object.isFrozen(config.connection));
});
test('fresh Windows installer database configuration matches private pilot credentials',()=>{
 const config=resolve(pilot);
 assert.equal(config.database,'hardware_pos_ars');
 assert.equal(config.container,'ars-windows-pilot-postgres');
 assert.equal(config.user,'ars');
 assert.equal(config.pilot,true);
 assert.equal(config.connection.password,pilot.ARS_WINDOWS_DB_PASSWORD);
 assert.equal(config.connection.database,config.database);
 assert.equal(config.connection.host,'127.0.0.1');
});
test('Windows database configuration accepts supported local IPv6 and postgres scheme',()=>{
 const config=resolve({DATABASE_URL:'postgres://postgres:fixture@[::1]:5433/hardware_pos'});
 assert.equal(config.host,'::1');
 assert.equal(config.connection.host,'::1');
});
test('Windows database configuration refuses unknown installation modes and mismatched identities',()=>{
 for(const config of [
  {...pilot,ARS_WINDOWS_PILOT:'0'},
  {...legacy,ARS_WINDOWS_PILOT:'1'},
  {...pilot,ARS_WINDOWS_PILOT:undefined},
  {...pilot,ARS_WINDOWS_DB_PASSWORD:'different'},
  {...pilot,ARS_WINDOWS_DB_PASSWORD:undefined},
  {...pilot,DATABASE_URL:pilot.DATABASE_URL.replace('ars:','postgres:')},
  {...legacy,DATABASE_URL:legacy.DATABASE_URL.replace('postgres:fixture','ars:fixture')},
  {...legacy,DATABASE_URL:legacy.DATABASE_URL.replace('/hardware_pos','/hardware_pos_ars')},
  {...pilot,DATABASE_URL:pilot.DATABASE_URL.replace('/hardware_pos_ars','/hardware_pos')}
 ])assert.throws(()=>resolve(config),/installation mode|credentials do not match/);
});
test('Windows database configuration refuses remote endpoints, invalid ports and URL overrides',()=>{
 for(const url of [
  'postgresql://postgres:fixture@db.example.com:5433/hardware_pos',
  'postgresql://postgres:fixture@localhost:5432/hardware_pos',
  'postgresql://postgres:fixture@localhost/hardware_pos',
  'postgresql://postgres:fixture@localhost:5433/hardware_pos?sslmode=require',
  'postgresql://postgres:fixture@localhost:5433/hardware_pos#other',
  'http://postgres:fixture@localhost:5433/hardware_pos',
  'postgresql://postgres@localhost:5433/hardware_pos',
  'postgresql://:fixture@localhost:5433/hardware_pos'
 ])assert.throws(()=>resolve({DATABASE_URL:url}),/Unsupported managed database endpoint/);
});
test('Windows database configuration rejects missing and malformed credentials without leaking secrets',()=>{
 for(const config of [undefined,{}, {DATABASE_URL:''},{DATABASE_URL:123}])assert.throws(()=>resolve(config),/Managed database configuration required/);
 assert.throws(()=>resolve({DATABASE_URL:'not-a-url'}),/Invalid managed database configuration/);
 for(const password of ['%ZZ','%00','%E0%A4%A'])assert.throws(()=>resolve({DATABASE_URL:'postgresql://postgres:'+password+'@localhost:5433/hardware_pos'}),/Invalid managed database credentials/);
});
