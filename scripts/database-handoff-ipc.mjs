// Rehearsal-only private child IPC. Does not start the POS or authorize DB access.
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHandoffAuthorization} from './database-handoff-authorization.mjs';
const fixture=fileURLToPath(new URL('./database-handoff-ipc-fixture.mjs',import.meta.url));
export async function rehearsePrivateHandoff(binding,{timeoutMs=5000,mode='normal'}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000||!['normal','wrong-binding','silent','replay'].includes(mode))throw Error('Invalid rehearsal options.');
 const child=fork(fixture,[mode],{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??''}});
 let grant,timer;
 try{
  if(!child.pid)throw Error('Rehearsal child unavailable.');
  const expected={...binding,candidatePid:child.pid};
  grant=createHandoffAuthorization(expected,{ttlMs:timeoutMs});
  return await new Promise((resolve,reject)=>{
   let accepted=false;
   let settled=false;
   const finish=(error,value)=>{
    if(settled)return;
    settled=true;
    clearTimeout(timer);
    error?reject(error):resolve(value);
   };
   timer=setTimeout(()=>finish(Error('Private handoff timed out.')),timeoutMs);
   child.on('error',()=>finish(Error('Private handoff process failed.')));
   child.on('disconnect',()=>{if(!accepted)finish(Error('Private handoff disconnected.'));});
   child.on('exit',code=>finish(code===0&&accepted?null:Error('Private handoff not verified.'),{authorizationVerified:true,liveStartupAllowed:false}));
   child.on('message',msg=>{
    if(!msg||msg.type!=='proof'||msg.schema!==1||accepted||!grant.consume(msg.token,msg.binding)){
     finish(Error('Private handoff proof rejected.'));
     return;
    }
    accepted=true;
    child.send({schema:1,type:'accepted'},error=>{if(error)finish(Error('Private handoff acknowledgement failed.'));});
   });
   child.send({schema:1,type:'challenge',token:grant.token,binding:expected},error=>{if(error)finish(Error('Private handoff challenge failed.'));});
  });
 }finally{
  clearTimeout(timer);
  grant?.revoke();
  if(child.exitCode===null&&child.signalCode===null)child.kill();
 }
}
