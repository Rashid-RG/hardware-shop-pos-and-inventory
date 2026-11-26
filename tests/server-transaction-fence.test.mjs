import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
test('explicit server transaction beginnings acquire shared transaction fence',()=>{
 const begins=s.match(/await client\.query\('BEGIN'\);/g)||[];
 assert.ok(begins.length>=12);
 assert.equal((s.match(/await client\.query\('BEGIN'\);\s+await acquireTransactionFence\(client\);/g)||[]).length,begins.length);
 assert.match(s,/pg_try_advisory_xact_lock_shared/);
 const startup=s.slice(s.indexOf('const acquireSingleWriterLease'),s.indexOf('const releaseSingleWriterLease'));
 assert.match(startup,/Outstanding fenced database transaction/);
 assert.ok(startup.indexOf('const fence =')<startup.indexOf('const fenceRelease ='));
});
