import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL('../scripts/'+n,import.meta.url),'utf8');
test('Windows final backup holds application writer lease and table locks through archive subprocess',()=>{
 const s=read('windows-locked-maintenance-backup.mjs');
 const p=read('prepare-windows-final-backup.ps1');
 assert.match(s,/pg_try_advisory_lock.*\[1642958133,1\]/);
 assert.ok(s.indexOf('IN SHARE MODE NOWAIT')<s.indexOf("child=spawn"));
 assert.ok(s.indexOf("child.once('close'")<s.indexOf("client.query('ROLLBACK')"));
 assert.ok(s.indexOf('await client.end()')>s.indexOf("client.query('ROLLBACK')"));
 assert.match(p,/windows-locked-maintenance-backup\.mjs/);
 assert.match(p,/externalWritersExcluded=\$false/);
 assert.match(p,/activationApproved=\$false/);
});
