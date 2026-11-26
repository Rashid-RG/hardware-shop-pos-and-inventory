import test from 'node:test';
import assert from 'node:assert/strict';
import { corroborateWindowsBoot } from '../scripts/drive-backup-windows-boot.mjs';
const prior={schema:1,hostDigest:'a'.repeat(64),bootUtc:'2026-11-25T08:00:00Z',eventUtc:'2026-11-25T08:00:10Z',eventRecord:'100'};
const next={...prior,bootUtc:'2026-11-26T08:00:00Z',eventUtc:'2026-11-26T08:00:10Z',eventRecord:'200'};
const started='2026-11-25T09:00:00Z';
test('Windows restart evidence requires matching host and independent increasing boot event',()=>{
 assert.equal(corroborateWindowsBoot(prior,next,started),true);
 for(const candidate of [prior,{...next,eventRecord:'99'},{...next,eventRecord:null},{...next,eventUtc:'2026-11-26T08:10:00Z'},{...next,hostDigest:'b'.repeat(64)}]){
  assert.equal(corroborateWindowsBoot(prior,candidate,started),false);
 }
 assert.equal(corroborateWindowsBoot({...prior,eventUtc:null},next,started),false);
});
