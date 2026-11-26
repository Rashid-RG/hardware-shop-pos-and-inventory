import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('server and maintenance acquire gate before writer lease and fail closed',()=>{
 const server=read('server.ts');
 const section=server.slice(server.indexOf('const acquireSingleWriterLease'),server.indexOf('const releaseSingleWriterLease'));
 assert.match(server,/DATABASE_HANDOFF_GATE_ID = 2/);
 assert.ok(section.indexOf('DATABASE_HANDOFF_GATE_ID')<section.indexOf('[SINGLE_WRITER_LOCK_CLASS, SINGLE_WRITER_LOCK_ID]'));
 assert.ok(section.indexOf('singleWriterLease = client')<section.indexOf('pg_advisory_unlock'));
 assert.ok(section.indexOf('pg_advisory_unlock')<section.indexOf('if (connectionLost)'));
 assert.match(section,/await client\.end\(\)/);
 for(const p of ['scripts/windows-locked-maintenance-backup.mjs','scripts/mint/locked-backup.mjs']){
  const s=read(p);
  assert.ok(s.indexOf('await acquireHandoffGate(client)')<s.indexOf('pg_try_advisory_lock'));
  assert.ok(s.indexOf('await client.end()')>s.indexOf("client.query('ROLLBACK')"));
 }
});
