// Internal maintenance child runner. Linux uses a dedicated process group.
// Escaped descendants and Windows process trees are not contained.
// Callers must not use this for destructive operations.
import {spawn} from 'node:child_process';

export async function runMaintenanceChild(session,command,args,{cwd,timeoutMs=120000,maxOutput=65536,inheritedFd}={}){
 if(typeof session?.assertActive!=='function'||!session.signal||typeof command!=='string'||!command||!Array.isArray(args)||args.some(a=>typeof a!=='string')||typeof cwd!=='string'||!cwd||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>1200000||!Number.isSafeInteger(maxOutput)||maxOutput<1||maxOutput>1048576)throw Error('Invalid maintenance child request.');
 if(inheritedFd!==undefined&&(process.platform!=='linux'||!Number.isInteger(inheritedFd)||inheritedFd<3))throw Error('Invalid inherited maintenance descriptor.');
 await session.assertActive();
 if(session.signal.aborted)throw Error('Maintenance interrupted.');
 const output=await new Promise((resolve,reject)=>{
  let failure,bytes=0,stdout=[],timer,escalation,monitor,inFlight,closed=false;
  const grouped=process.platform==='linux';
  const stdio=['ignore','pipe','pipe'];
  if(inheritedFd!==undefined)stdio.push(inheritedFd);
  const child=spawn(command,args,{cwd,shell:false,windowsHide:true,detached:grouped,stdio});
  function signalChild(signal){
   if(grouped&&Number.isSafeInteger(child.pid)&&child.pid>1){
    try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
   }else child.kill(signal);
  }
  function groupPresent(){
   if(!grouped||!Number.isSafeInteger(child.pid)||child.pid<=1)return false;
   try{process.kill(-child.pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;return true;}
  }
  function interrupt(reason){
   if(failure)return;
   failure=Error(reason);
   clearTimeout(monitor);
   if(closed)return;
   try{signalChild('SIGTERM');}catch{}
   escalation=setTimeout(()=>{try{signalChild('SIGKILL');}catch{}},5000);
   escalation.unref();
  }
  const abort=()=>interrupt('Maintenance interrupted.');
  function collect(chunk,retain){
   bytes+=chunk.length;
   if(bytes>maxOutput){interrupt('Maintenance child output limit exceeded.');return;}
   if(retain&&!failure)stdout.push(chunk);
  }
  child.stdout.on('data',chunk=>collect(chunk,true));
  child.stderr.on('data',chunk=>collect(chunk,false));
  child.once('error',()=>interrupt('Maintenance child failed.'));
  function monitorProtection(){
   if(closed||failure)return;
   monitor=setTimeout(()=>{
    inFlight=(async()=>{
     try{
      await session.assertActive();
      if(session.signal.aborted)abort();
     }catch{
      interrupt('Maintenance protection lost.');
     }
    })();
    void inFlight.then(monitorProtection);
   },2000);
  }
  child.once('close',async(code,signal)=>{
   closed=true;
   clearTimeout(timer);clearTimeout(escalation);clearTimeout(monitor);
   session.signal.removeEventListener('abort',abort);
   // Even a successful parent must not leave same-group descendants running.
   if(groupPresent()){
    try{signalChild('SIGKILL');}catch{}
    failure=failure||Error('Maintenance process group remained active.');
   }
   await inFlight;
   if(failure||code!==0||signal){reject(failure||Error('Maintenance child did not complete.'));return;}
   resolve(Buffer.concat(stdout).toString('utf8'));
  });
  timer=setTimeout(()=>interrupt('Maintenance child timed out.'),timeoutMs);
  session.signal.addEventListener('abort',abort,{once:true});
  if(session.signal.aborted)abort();
  monitorProtection();
 });
 await session.assertActive();
 if(session.signal.aborted)throw Error('Maintenance interrupted.');
 return output;
}
