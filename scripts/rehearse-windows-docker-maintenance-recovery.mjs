// Run on Windows with Docker Desktop (Linux containers), npm ci, and a built
// maintenance supervisor: node scripts/rehearse-windows-docker-maintenance-recovery.mjs <supervisor.exe>
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {withMaintenanceSession} from './database-maintenance-session.mjs';
import {withMaintenanceTableFence} from './database-maintenance-table-fence.mjs';
import {readProtectedMaintenanceClusterIdentity} from './maintenance-cluster-identity.mjs';
import {runProtectedWindowsBackup} from './windows-protected-backup-stage.mjs';

if (process.platform !== 'win32' || process.argv.length !== 3) {
 throw Error('Windows, local Docker Desktop, and a maintenance supervisor executable are required.');
}
for (const key of ['ARS_RUNTIME_ROOT','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) {
 if (process.env[key] !== undefined) throw Error('Remove the '+key+' override for this rehearsal.');
}
const supervisor=await realpath(resolve(process.argv[2]));
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:180000,windowsHide:true}).trim();
assert.ok(['npipe:////./pipe/docker_engine','npipe:////./pipe/dockerDesktopLinuxEngine'].includes(docker('context','inspect','--format','{{.Endpoints.docker.Host}}')));
assert.equal(docker('info','--format','{{.OSType}}'),'linux');

for (const [database,container,user] of [
 ['hardware_pos','hardware-pos-postgres','postgres'],
 ['hardware_pos_ars','ars-windows-pilot-postgres','ars']
]) {
 const root=await realpath(await mkdtemp(join(tmpdir(),'ars-docker-recovery-')));
 const password=randomUUID();
 let containerId;
 try {
  // Docker rejects a name collision. Cleanup only targets the container this run created.
  containerId=docker('run','-d','--name',container,'-p','127.0.0.1::5432',
   '-e','POSTGRES_DB='+database,'-e','POSTGRES_USER='+user,
   '-e','POSTGRES_PASSWORD='+password,'postgres:16-alpine');
  assert.match(containerId,/^[a-f0-9]{64}$/);
  const port=docker('port',containerId,'5432/tcp').match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  assert.ok(port,'Expected a disposable loopback port');
  const connectionString='postgresql://'+user+':'+password+'@127.0.0.1:'+port+'/'+database;
  const client=()=>new pg.Client({connectionString,connectionTimeoutMillis:3000,query_timeout:10000});
  const scripts=join(root,'scripts'),destination=join(root,'recovery');
  await Promise.all([mkdir(scripts),mkdir(destination),mkdir(join(root,'uploads'))]);
  await Promise.all(['backup-local-postgres.ps1','windows-docker-cluster-identity.ps1',
   'windows-maintenance-backup-worker.ps1','windows-runtime-paths.ps1'].map(name=>
   copyFile(new URL(name,import.meta.url),join(scripts,name))));
  await writeFile(join(root,'.env.local'),'DATABASE_URL='+connectionString+'\n');
  await writeFile(join(root,'uploads','fixture.txt'),'Disposable upload fixture\n');

  let setup;
  for (let attempt=0; attempt<60; attempt++) {
   const candidate=client();
   try {
    await candidate.connect();
    setup=candidate;
    break;
   } catch (error) {
    await candidate.end().catch(()=>{});
    if (attempt===59) throw error;
    await delay(1000);
   }
  }
  try {
   await setup.query('CREATE TABLE recovery_fixture (id integer PRIMARY KEY, amount integer NOT NULL)');
   await setup.query('INSERT INTO recovery_fixture VALUES (1, 125), (2, 375)');
  } finally {
   await setup.end();
  }

  const original=client();
  const archive=await withMaintenanceSession(original,database,session=>
   withMaintenanceTableFence(original,session,async scope=>{
    const identity=await readProtectedMaintenanceClusterIdentity(original,scope);
    const backup=clusterIdentity=>runProtectedWindowsBackup(scope,{root,destination,supervisor,clusterIdentity,timeoutMs:120000});
    const wrongSystemIdentifier=identity.systemIdentifier==='1'?'2':'1';
    await assert.rejects(backup({...identity,systemIdentifier:wrongSystemIdentifier}),/Native maintenance worker did not complete/);
    assert.deepEqual(await readdir(destination),[]);
    const result=await backup(identity);
    assert.match(result.archive,/-with-uploads\.dump$/);
    return result.archive;
   }));

  const uploadArchive=archive.replace(/\.dump$/,'-uploads.zip');
  const uploadDigest=createHash('sha256').update(await readFile(uploadArchive)).digest('hex');
  const recordedUploadDigest=(await readFile(uploadArchive+'.sha256','ascii')).split(/\s+/)[0];
  assert.equal(uploadDigest,recordedUploadDigest.toLowerCase());

  const restoreDatabase='ars_recovery_fixture';
  docker('exec',containerId,'createdb','-U',user,restoreDatabase);
  docker('cp',archive,containerId+':/tmp/ars-recovery-fixture.dump');
  docker('exec',containerId,'pg_restore','--exit-on-error','-U',user,'-d',restoreDatabase,'/tmp/ars-recovery-fixture.dump');
  const rows=docker('exec',containerId,'psql','-XAt','-v','ON_ERROR_STOP=1','-U',user,'-d',restoreDatabase,
   '-c','SELECT id,amount FROM recovery_fixture ORDER BY id');
  assert.deepEqual(rows.split(/\r?\n/),['1|125','2|375']);
  console.log(database+': protected Docker backup and isolated PostgreSQL restore passed.');
 } finally {
  try {
   if (/^[a-f0-9]{64}$/.test(containerId??'')) docker('rm','-fv',containerId);
  } finally {
   await rm(root,{recursive:true,force:true});
  }
 }
}
