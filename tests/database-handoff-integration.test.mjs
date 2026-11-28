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
 const windows=read('scripts/windows-locked-maintenance-backup.mjs');
 const mint=read('scripts/mint/locked-backup.mjs');
 const session=read('scripts/database-maintenance-session.mjs');
 const fence=read('scripts/database-maintenance-table-fence.mjs');
 for(const s of [session]){
  const gate=s.indexOf('await acquireHandoffGate(client)');
  const writer=s.indexOf('pg_try_advisory_lock');
  assert.ok(gate>=0&&writer>gate);
 }
 assert.match(mint,/withMaintenanceSession\(client,'hardware_pos_ars',session=>withMaintenanceTableFence\(client,session,/);
 assert.match(session,/finally\{[\s\S]*await client\.end\(\)/);
 assert.match(fence,/finally\{[\s\S]*await client\.query\('ROLLBACK'\)/);
 assert.match(windows,/withMaintenanceSession\(client,config\.database,session=>withMaintenanceTableFence\(client,session,/);
 assert.match(windows,/await runVerifiedInstalledWindowsBackup\(client,scope,\{root,destination\}\)/);
 assert.doesNotMatch(windows,/\bspawn\s*\(/);
});
