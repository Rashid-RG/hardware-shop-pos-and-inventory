// Read-only readiness check for the process started by the local updater.
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
class RetryableReadinessError extends Error {}

// Bound the complete response, not just its headers. An unexpected local
// listener must not consume unbounded memory or delay recovery indefinitely.
async function readReadinessBody(response){
 const maximum=16384;
 if(!response.body)throw Error('Missing POS readiness response.');
 const reader=response.body.getReader();
 const chunks=[];
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>maximum)throw Error('POS readiness response exceeds limit.');
   chunks.push(Buffer.from(value));
  }
  try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}
  catch{throw Error('Invalid POS readiness response.');}
 }finally{
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}

function validateTarget(version,pid,port){
 if(typeof version!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(version)||
    !Number.isSafeInteger(pid)||pid<1||!Number.isInteger(port)||port<1||port>65535){
  throw Error('Expected release version, process ID and valid local port required.');
 }
}

export async function verifyInstalledRelease(version,pid,port=3000,{signal,timeoutMs=3000}={}){
 validateTarget(version,pid,port);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3000)throw Error('Invalid readiness request timeout.');
 const deadline=AbortSignal.timeout(timeoutMs);
 const combined=signal?AbortSignal.any([signal,deadline]):deadline;
 let response;
 try{response=await fetch('http://127.0.0.1:'+port+'/api/ready',{redirect:'error',signal:combined});}
 catch(error){
  if(signal?.aborted)throw Error('Startup readiness cancelled.');
  if(deadline.aborted||error.cause?.code==='ECONNREFUSED')throw new RetryableReadinessError('POS readiness unavailable.');
  throw error;
 }
 if(!response.ok){await response.body?.cancel();if(response.status===503)throw new RetryableReadinessError('POS reported that it is not ready.');throw Error('POS readiness request failed.');}
 const result=await readReadinessBody(response);
 if(result?.ok!==true||result.status!=='ready'||result.database!=='reachable'||
    result.sourceOfTruth!=='normalized'||result.buildVersion!==version||result.processId!==pid){
  throw Error('Readiness does not match the expected POS process and release.');
 }
 if(combined.aborted)throw Error('Startup readiness cancelled or expired.');
}

// A successful observation is not authorization to switch releases or start
// a writer. Retry only unavailable service/503, never wrong identity or malformed data.
export async function waitForInstalledRelease(version,pid,{port=3000,timeoutMs=60000,intervalMs=250,signal,assertActive}={}){
 validateTarget(version,pid,port);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isSafeInteger(intervalMs)||intervalMs<10||intervalMs>5000||typeof assertActive!=='function')throw Error('Invalid protected startup wait.');
 const start=performance.now();
 const check=async()=>{
  if(signal?.aborted)throw Error('Startup readiness cancelled.');
  await assertActive();
  if(signal?.aborted)throw Error('Startup readiness cancelled.');
  if(performance.now()-start>=timeoutMs)throw Error('Startup readiness deadline exceeded.');
 };
 while(true){
  await check();
  const remaining=Math.max(1,Math.floor(timeoutMs-(performance.now()-start)));
  let ready=false;
  try{await verifyInstalledRelease(version,pid,port,{signal,timeoutMs:Math.min(3000,remaining)});ready=true;}
  catch(error){if(!(error instanceof RetryableReadinessError))throw error;}
  await check();
  if(ready)return;
  try{await delay(Math.min(intervalMs,Math.max(1,timeoutMs-(performance.now()-start))),undefined,{signal});}
  catch(error){if(signal?.aborted)throw Error('Startup readiness cancelled.');throw error;}
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [version, pid, port = '3000', ...extra] = process.argv.slice(2);
  if (!pid || extra.length) throw Error('Usage: node verify-installed-release-readiness.mjs VERSION PID [PORT]');
  await verifyInstalledRelease(version, Number(pid), Number(port));
  console.log('Expected POS release and process are ready.');
 }catch(error){
  console.error(error.message);
  process.exitCode=1;
 }
}
