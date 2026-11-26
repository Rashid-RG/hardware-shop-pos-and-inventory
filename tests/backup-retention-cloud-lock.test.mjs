import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('local backup retention defers while cloud execution evidence exists on Windows and Mint',()=>{
 const ps=read('../scripts/backup-local-postgres.ps1');
 const mint=read('../scripts/mint/backup.py');
 const drive=read('../scripts/drive-backup.mjs');
 assert.match(ps,/Get-ChildItem -LiteralPath \$lockDirectory -Force -ErrorAction Stop/);
 assert.match(ps,/if \(\$driveEvidence.Count -gt 0\) \{[\s\S]*?retention deferred[\s\S]*?\} else \{[\s\S]*?Select-Object -Skip \$Keep/);
 assert.match(mint,/if os\.path\.lexists\(BACKUPS \/ '\.ars-drive-backup\.lock'\):[\s\S]*?retention deferred[\s\S]*?else:[\s\S]*?for old in completed\[30:\]/);
 assert.match(drive,/withDriveBackupLock\(directory, async \(\) => runDailyBackup\(directory\)\)/);
});
