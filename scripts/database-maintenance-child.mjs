// Internal maintenance child runner. Direct children only; no process-tree
// termination guarantee. Callers must not use this for destructive operations.
import {spawn} from 'node:child_process';

export async function runMaintenanceChild(session,command,args,{cwd,timeoutMs=120000,maxOutput=65536}={}){
 if(typeof session?.assertActive!=='function'||!session.signal||typeof command!=='string'||!command||!Array.isArray(args)||args.some(a=>typeof a!=='string')||typeof cwd!=='string'||!cwd||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>1200000||!Number.isSafeInteger(maxOutput)||maxOutput<1||maxOutput>1048576)throw Error('Invalid maintenance child request.');
 await session.assertActive();
 if(session.signal.aborted)throw Error('Maintenance interrupted.');
 const output=await new Promise((resolve,reject)=>{
  let failure,bytes=0,stdout=[],timer,escalation;
  const child=spawn(command,args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  function interrupt(reason){
   if(failure)return;
   failure=Error(reason);
   try{child.kill('SIGTERM');}catch{}
   escalation=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}},5000);
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
  child.once('close',(code,signal)=>{
   clearTimeout(timer);clearTimeout(escalation);
   session.signal.removeEventListener('abort',abort);
   if(failure||code!==0||signal){reject(failure||Error('Maintenance child did not complete.'));return;}
   resolve(Buffer.concat(stdout).toString('utf8'));
  });
  timer=setTimeout(()=>interrupt('Maintenance child timed out.'),timeoutMs);
  session.signal.addEventListener('abort',abort,{once:true});
  if(session.signal.aborted)abort();
 });
 await session.assertActive();
 if(session.signal.aborted)throw Error('Maintenance interrupted.');
 return output;
}
