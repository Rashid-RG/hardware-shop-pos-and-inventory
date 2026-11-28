// Internal Windows supervisor adapter. Only trusted, verified runtime binaries
// and non-destructive maintenance workers may be supplied by the coordinator.
// Successful exit is not authorization to remove or replace installed software.
import {spawn} from 'node:child_process';
import {isAbsolute,extname} from 'node:path';

export async function runWindowsMaintenanceWorker(session,supervisor,command,args,{cwd,timeoutMs=120000}={}){
 if(process.platform!=='win32')throw Error('Windows maintenance supervisor required.');
 const absoluteExe=p=>typeof p==='string'&&isAbsolute(p)&&extname(p).toLowerCase()==='.exe'&&!p.includes('\0');
 if(typeof session?.assertActive!=='function'||typeof session.signal?.addEventListener!=='function'||!absoluteExe(supervisor)||!absoluteExe(command)||!Array.isArray(args)||args.some(a=>typeof a!=='string'||a.includes('\0'))||typeof cwd!=='string'||!isAbsolute(cwd)||cwd.includes('\0')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>1200000)throw Error('Invalid native maintenance request.');
 await session.assertActive();
 if(session.signal.aborted)throw Error('Maintenance interrupted.');
 await new Promise((resolve,reject)=>{
  const child=spawn(supervisor,['--private-worker-v1',String(timeoutMs),cwd,command,...args],{cwd,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
  let failure,deadline,cleanup,monitorTimer,inFlight,closed=false;
  function revoke(reason){
   if(failure)return;
   failure=Error(reason);
   clearTimeout(monitorTimer);
   // Closing the private control stream requests native cancellation. Allow
   // native job termination verification before forcing supervisor shutdown.
   child.stdin.destroy();
   cleanup=setTimeout(()=>{try{child.kill();}catch{}},25000);
  }
  const abort=()=>revoke('Maintenance interrupted.');
  child.stdin.on('error',()=>revoke('Maintenance control stream failed.'));
  child.stdout.on('data',()=>revoke('Unexpected native maintenance output.'));
  child.stderr.on('data',()=>revoke('Unexpected native maintenance output.'));
  child.once('error',()=>revoke('Native maintenance supervisor failed.'));
  child.once('close',async(code,signal)=>{
   closed=true;
   clearTimeout(monitorTimer);
   clearTimeout(deadline);clearTimeout(cleanup);
   session.signal.removeEventListener('abort',abort);
   child.stdin.destroy();
   // Drain the last ownership check before allowing the caller to release its session.
   if(inFlight)await inFlight;
   if(failure||code!==0||signal){reject(failure||Error('Native maintenance worker did not complete.'));return;}
   resolve();
  });
  // Serial checks avoid overlapping queries on the dedicated PostgreSQL client.
  // Polling detects persistent loss, not every possible transient change.
  function scheduleCheck(){
   if(closed||failure)return;
   monitorTimer=setTimeout(()=>{
    if(closed||failure)return;
    inFlight=(async()=>{
     try{
      await session.assertActive();
      if(session.signal.aborted)revoke('Maintenance interrupted.');
     }catch{
      if(closed){if(!failure)failure=Error('Maintenance protection lost.');}
      else revoke('Maintenance interrupted.');
     }
    })();
    inFlight.then(()=>{inFlight=undefined;scheduleCheck();});
   },2000);
  }
  scheduleCheck();
  deadline=setTimeout(()=>revoke('Native maintenance supervisor timed out.'),timeoutMs+5000);
  session.signal.addEventListener('abort',abort,{once:true});
  if(session.signal.aborted)abort();
  else child.stdin.write('A',error=>{if(error)revoke('Maintenance authorization failed.');});
 });
 await session.assertActive();
 if(session.signal.aborted)throw Error('Maintenance interrupted.');
}
