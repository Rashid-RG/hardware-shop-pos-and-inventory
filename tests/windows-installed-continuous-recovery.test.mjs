import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInstalledWindowsContinuousRecovery} from '../scripts/windows-installed-continuous-recovery.mjs';
const source=readFileSync(new URL('../scripts/windows-installed-continuous-recovery.mjs',import.meta.url),'utf8');
test('installed coordinator rejects absent and cancelled recovery requests',async()=>{
 await assert.rejects(runInstalledWindowsContinuousRecovery(),/Unsupported recovery environment/);
 const c=new AbortController();c.abort();
 await assert.rejects(runInstalledWindowsContinuousRecovery({signal:c.signal}),/Unsupported recovery environment/);
});
test('installed coordinator rejects unsupported platforms before accessing recovery files',{skip:process.platform==='win32'},async()=>{
 await assert.rejects(runInstalledWindowsContinuousRecovery({root:'/nonexistent',destination:'/nonexistent',signal:new AbortController().signal}),/Unsupported recovery environment/);
});
test('installed coordinator uses one dedicated client and fixed recovery stage implementations',()=>{
 assert.equal((source.match(/new pg\.Client\(/g)||[]).length,1);
 assert.match(source,/return withProtectedWindowsRecovery\(client,config\.database,\{/);
 assert.match(source,/await runWindowsContinuousBackupStage\(client,scope,\{root:runtime,destination:folder\}\)/);
 assert.match(source,/return prepareWindowsContinuousRecoveryMetadata\(scope,backup,\{root:runtime,destination:folder,control\}\)/);
 assert.match(source,/return runVerifiedInstalledWindowsRestore\(scope,\{root:runtime,destination:folder\}\)/);
 assert.match(source,/await verifyWindowsRestoreEvidence\(scope,\{destination:folder,control\}\)/);
 assert.doesNotMatch(source,/client\.(?:connect|end|query)\(|process\.argv|pg_restore|rmSync|unlinkSync/);
});
test('installed coordinator retains existing recovery files and compares final observation and archive digests',()=>{
 const preserve=source.indexOf('Existing recovery evidence must be retained.');
 const session=source.indexOf('new pg.Client(');
 assert.ok(preserve>=0&&session>preserve);
 assert.match(source,/evidence\.observationDigest!==restored\.observationDigest/);
 assert.match(source,/evidence\.archiveSha256!==restored\.archiveSha256/);
 assert.match(source,/evidence\.uninstallId!==metadata\.uninstallId/);
 assert.match(source,/applicationRemovalAllowed:false,databaseDeletionAllowed:false,serviceRemovalAllowed:false,uninstalled:false,finalUninstallBackupVerified:false,continuousExclusionVerified:false/);
});
