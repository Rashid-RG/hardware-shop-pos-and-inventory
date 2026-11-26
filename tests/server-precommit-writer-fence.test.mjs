import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
test('explicit server transaction commits require current writer ownership observation',()=>{
 const commits=s.match(/await client\.query\('COMMIT'\);/g)||[];
 assert.ok(commits.length>=13);
 assert.equal((s.match(/await assertWriterBeforeCommit\(\);\s+await client\.query\('COMMIT'\);/g)||[]).length,commits.length);
 const fence=s.slice(s.indexOf('const assertWriterBeforeCommit'),s.indexOf('const LOGIN_ATTEMPT_LIMIT'));
 assert.match(fence,/pg_locks/);
 assert.match(fence,/pid=pg_backend_pid\(\)/);
 assert.match(fence,/recordWriterLoss/);
});
