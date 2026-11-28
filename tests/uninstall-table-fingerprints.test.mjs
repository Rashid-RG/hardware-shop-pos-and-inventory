import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fingerprintPublicTables,assertFingerprintMatch} from '../scripts/uninstall-table-fingerprints.mjs';
test('fingerprints preserve duplicate rows and reject changed values',async()=>{
 const {createHash}=await import('node:crypto');
 let batches=0;
 const client={async query(sql){
  if(sql.startsWith('SELECT tablename'))return {rows:[{tablename:'customers'}]};
  if(sql.startsWith('FETCH'))return {rows:batches++?[]:[{value:'{"id":1}'},{value:'{"id":1}'}]};
  return {rows:[]};
 }};
 const actual=await fingerprintPublicTables(client);
 const expected={customers:{rows:2,sha256:createHash('sha256').update('{"id":1}\n{"id":1}\n').digest('hex')}};
 assertFingerprintMatch(expected,actual);
 assert.throws(()=>assertFingerprintMatch(expected,{customers:{rows:2,sha256:'a'.repeat(64)}}));
 assert.throws(()=>assertFingerprintMatch(expected,{}));
});
