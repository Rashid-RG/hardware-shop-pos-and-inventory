import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ps=readFileSync(new URL('../scripts/backup-local-postgres.ps1',import.meta.url),'utf8');
const local=readFileSync(new URL('../scripts/backup-local.mjs',import.meta.url),'utf8');
const cloud=readFileSync(new URL('../scripts/drive-backup.mjs',import.meta.url),'utf8');
test('Windows local archive stage uses a common exclusive runtime lock across callers',()=>{
 assert.match(ps,/Join-Path \$runtimeRoot 'backups'/);
 assert.match(ps,/\.ars-local-backup\.lock/);
 assert.match(ps,/\[IO.FileMode\]::CreateNew/);
 assert.match(ps,/\[IO.FileShare\]::None/);
 assert.ok(ps.indexOf('[IO.FileMode]::CreateNew')<ps.indexOf('pg_dump'));
 assert.match(ps,/if \(\$null -ne \$localLock\)/);
 assert.match(local,/backup-local-postgres\.ps1/);
 assert.match(cloud,/backup-local-postgres\.ps1/);
});
