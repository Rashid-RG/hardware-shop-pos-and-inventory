// Windows Docker Desktop isolated restore. No live container, credentials, volume or port.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {createReadStream} from 'node:fs';
import {lstat,realpath} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const run=promisify(execFile);
const tables=['products','customers','sales_transactions','sales_transaction_items','purchase_orders','purchase_order_items','supplier_payments','customer_credit_payments'];
export function isolatedContainerArgs(name,password){
 if(!/^ars-incident-test-[a-f0-9]{32}$/.test(name)||! /^[a-f0-9]{64}$/.test(password))throw Error('Invalid isolated instance identity.');
 return ['run','-d','--pull=never','--network','none','--name',name,'--label','com.rsnextward.ars-purpose=incident-restore-test','--tmpfs','/var/lib/postgresql/data:rw,mode=0700','-e','POSTGRES_USER=restore_admin','-e','POSTGRES_DB=ars_rehearsal','-e','POSTGRES_PASSWORD='+password,'postgres:16-alpine'];
}
export async function runWindowsIsolatedRestore(root,backup){
 if(process.platform!=='win32'||backup.state!=='archive-integrity-matched'||!/^ars-[A-Za-z0-9_-]+\.dump$/.test(backup.archive)||! /^[a-f0-9]{64}$/.test(backup.archiveSha256))throw Error('Verified Windows backup required.');

 const invokeDocker=async(args,timeout=900000)=>(await run('docker.exe',args,{timeout,maxBuffer:1048576,windowsHide:true})).stdout.trim();
 if(process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('Docker endpoint override not allowed.');
 const context=await invokeDocker(['context','show'],5000);
 const endpoint=await invokeDocker(['context','inspect',context,'--format','{{.Endpoints.docker.Host}}'],5000);
 if(!/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_-]+$/.test(endpoint))throw Error('Local Docker Desktop endpoint required.');
 const docker=(args,timeout)=>invokeDocker(['--host',endpoint,...args],timeout);
 const name='ars-incident-test-'+randomUUID().replaceAll('-','');
 const command=isolatedContainerArgs(name,randomBytes(32).toString('hex'));
 let id;
 try{
  await docker(['image','inspect','postgres:16-alpine'],10000);
  id=await docker(command,120000);
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid test container ID.');
  const config=JSON.parse(await docker(['inspect',id,'--format','{{json .}}'],10000));
  if(config.Name!=='/'+name||config.Config.Labels['com.rsnextward.ars-purpose']!=='incident-restore-test'||config.HostConfig.NetworkMode!=='none'||Object.keys(config.HostConfig.PortBindings??{}).length||config.HostConfig.Privileged||!config.HostConfig.Tmpfs?.['/var/lib/postgresql/data']||config.Mounts.some(m=>m.Type!=='tmpfs'))throw Error('Test container isolation not verified.');
  let ready=false;
  for(let i=0;i<90;i++){try{await docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','restore_admin','-d','ars_rehearsal'],5000);ready=true;break;}catch{await delay(2000);}}
  if(!ready)throw Error('Test database unavailable.');
  await docker(['cp',join(root,'backups',backup.archive),id+':/tmp/incident.dump']);
  const copied=await docker(['exec',id,'sha256sum','/tmp/incident.dump']);
  if(copied.split(/\s+/)[0]!==backup.archiveSha256)throw Error('Copied archive mismatch.');
  await docker(['exec',id,'pg_restore','-U','restore_admin','-d','ars_rehearsal','--single-transaction','--exit-on-error','--no-owner','--no-acl','/tmp/incident.dump']);
  let uploadArchiveChecked=false;
  if(backup.uploadsIncluded){
   const zip=join(root,'backups',backup.archive.slice(0,-5)+'-uploads.zip');
   const sidecar=zip+'.sha256';
   const stat=await lstat(zip),meta=await lstat(sidecar);
   if(!stat.isFile()||!meta.isFile()||meta.size>4096||(await realpath(zip)).toLowerCase()!==zip.toLowerCase()||(await realpath(sidecar)).toLowerCase()!==sidecar.toLowerCase())throw Error('Invalid upload archive.');
   const {readFile}=await import('node:fs/promises');
   const expected=(await readFile(sidecar,'utf8')).trim().split(/\s+/)[0].toLowerCase();
   if(!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid upload checksum.');
   const hash=createHash('sha256');
   for await(const chunk of createReadStream(zip))hash.update(chunk);
   if(hash.digest('hex')!==expected)throw Error('Upload checksum mismatch.');
   await docker(['cp',zip,id+':/tmp/incident-uploads.zip']);
   if((await docker(['exec',id,'sha256sum','/tmp/incident-uploads.zip'])).split(/\s+/)[0]!==expected)throw Error('Copied uploads mismatch.');
   // BusyBox unzip -t is not portable across versions. Stream decompressed
   // bytes to /dev/null, with no extracted paths and no live filesystem.
   await docker(['exec',id,'sh','-c','unzip -p /tmp/incident-uploads.zip >/dev/null']);
   uploadArchiveChecked=true;
  }
  const counts={};
  for(const t of tables){
   const n=await docker(['exec',id,'psql','-X','-U','restore_admin','-d','ars_rehearsal','-v','ON_ERROR_STOP=1','-Atc','SELECT count(*) FROM public."'+t+'"']);
   if(!/^\d+$/.test(n)||!Number.isSafeInteger(Number(n)))throw Error('Invalid restored count.');
   counts[t]=Number(n);
  }
  return {backup:backup.archive,sha256:backup.archiveSha256,testedAt:new Date().toISOString(),restoreTestPassed:true,liveRestoreApproved:false,isolation:'separate-postgres-instance',liveVolumeMounted:false,publishedPort:false,counts,uploadArchiveChecked};
 }catch{throw Error('Isolated Windows restore failed; no recovery authorized.');}
 finally{if(/^[a-f0-9]{64}$/.test(id??''))await docker(['rm','-f','-v',id],120000);}
}
