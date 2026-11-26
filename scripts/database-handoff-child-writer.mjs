// Disposable-only process-bound writer rehearsal. No production startup or writes.
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHandoffAuthorization} from './database-handoff-authorization.mjs';
import {assertGateOwner,HANDOFF_CLASS} from './database-handoff-gate.mjs';
const fixture=fileURLToPath(new URL('./database-handoff-writer-child.mjs',import.meta.url));
export async function rehearseChildWriter(coordinator,connection,keys,binding){
 const u=new URL(connection);
 if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/hardware_pos_ci'||!['postgres:','postgresql:'].includes(u.protocol)||u.search||u.hash)throw Error('Disposable database required.');
 const ids=[keys?.gateId,keys?.writerId,keys?.fenceId];
 if(!ids.every(n=>Number.isInteger(n)&&n>=10&&n<=2147483647)||new Set(ids).size!==3)throw Error('Disposable keys required.');
 const r=await coordinator.query("SELECT current_database() AS database,pg_backend_pid() AS pid,backend_start::text AS started,system_identifier::text AS cluster,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid FROM pg_stat_activity,pg_control_system() WHERE pid=pg_backend_pid()");
 const owner=r.rows[0];
 if(r.rows.length!==1||owner.database!=='hardware_pos_ci')throw Error('Disposable coordinator required.');
 await assertGateOwner(coordinator,owner,{lockClass:HANDOFF_CLASS,lockId:keys.gateId});
 const child=fork(fixture,[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??''}});
 let grant,timer;
 const exited=new Promise(resolve=>child.once('close',resolve));
 let closed=false;
 child.once('close',()=>{closed=true;});
 // Register immediately: fork can fail before a challenge is issued.
 child.on('error',()=>{});
 try{
  grant=createHandoffAuthorization({...binding,candidatePid:child.pid},{ttlMs:10000});
  return await new Promise((resolve,reject)=>{
   let phase='proof',settled=false;
   const finish=(e,v)=>{if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve(v);};
   timer=setTimeout(()=>finish(Error('Writer fixture timed out.')),15000);
   child.on('error',()=>finish(Error('Writer fixture failed.')));
   child.on('exit',code=>finish(code===0&&phase==='released'?null:Error('Writer fixture exited early.'),{state:'child-writer-rehearsed',authorizationVerified:true,childHeldWriterAndFence:true,liveStartupAllowed:false,recoveryAllowed:false}));
   const send=m=>child.send(m,e=>{if(e)finish(Error('IPC failed.'));});
   child.on('message',async m=>{
    try{
     if(settled||m?.schema!==1)throw Error('Invalid message.');
     if(phase==='proof'&&m.type==='proof'&&grant.consume(m.token,m.binding)){
      phase='holding';
      await assertGateOwner(coordinator,owner,{lockClass:HANDOFF_CLASS,lockId:keys.gateId});
      send({schema:1,type:'accepted',connection:u.toString(),keys,owner});
     }else if(phase==='holding'&&m.type==='holding'){
      phase='verifying';
      if(m.owner?.pid===owner.pid||m.owner?.cluster!==owner.cluster||m.owner?.oid!==owner.oid)throw Error('Child database identity mismatch.');
      for(const lockId of [keys.writerId,keys.fenceId])await assertGateOwner(coordinator,m.owner,{lockClass:HANDOFF_CLASS,lockId});
      await assertGateOwner(coordinator,owner,{lockClass:HANDOFF_CLASS,lockId:keys.gateId});
      phase='released';send({schema:1,type:'release'});
     }else throw Error('Unexpected message.');
    }catch(e){finish(e);}
   });
   send({schema:1,type:'challenge',token:grant.token,binding:{...binding,candidatePid:child.pid}});
  });
 }finally{
  clearTimeout(timer);grant?.revoke();
  if(!closed){
   if(child.pid&&child.exitCode===null&&child.signalCode===null)child.kill();
   let cleanupTimer;
   try{await Promise.race([exited,new Promise((_,reject)=>{cleanupTimer=setTimeout(()=>reject(Error('Writer fixture termination unconfirmed.')),5000);})]);}
   finally{clearTimeout(cleanupTimer);}
  }
 }
}
