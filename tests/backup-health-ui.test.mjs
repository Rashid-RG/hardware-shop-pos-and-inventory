import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/components/BackupRecoveryView.tsx',import.meta.url),'utf8');
test('backup diagnostics are fixed read-only admin endpoints and integrated into backup center',()=>{
 for(const endpoint of ['drive-health','drive-recovery-inspection']){
  assert.ok(server.includes("app.get('/api/backup/"+endpoint+"', requireRole(['Super Admin'])"));
  assert.ok(ui.includes("'/api/backup/"+endpoint+"'"));
 }
 assert.match(server,/\['?scripts\/drive-backup\.mjs/); 
 assert.match(ui,/health\.lockPresent/);
 assert.match(ui,/Inspect recovery evidence/);
 assert.match(ui,/No lock removal, retry, upload or restoration authorized/);
});
