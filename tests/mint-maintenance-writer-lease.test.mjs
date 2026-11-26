import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Mint maintenance backup acquires same application writer lease before table locks',()=>{
 const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const backup=readFileSync(new URL('../scripts/mint/locked-backup.mjs',import.meta.url),'utf8');
 assert.match(server,/SINGLE_WRITER_LOCK_CLASS = 1642958133/);
 assert.match(server,/SINGLE_WRITER_LOCK_ID = 1/);
 assert.match(backup,/pg_try_advisory_lock.*\[1642958133,1\]/);
 assert.ok(backup.indexOf('pg_try_advisory_lock')<backup.indexOf("client.query('BEGIN')"));
 assert.ok(backup.indexOf('await client.end()')>backup.indexOf('await client.query(\'ROLLBACK\')'));
});
