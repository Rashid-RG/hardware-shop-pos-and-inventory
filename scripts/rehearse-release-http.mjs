// Disposable process used by the Windows switch journal rehearsal.
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {waitForInstalledRelease} from './verify-installed-release-readiness.mjs';

if(process.send){
 const {createServer}=await import('node:http');
 const server=createServer((_request,response)=>response.end(JSON.stringify({
  ok:true,status:'ready',database:'reachable',sourceOfTruth:'normalized',
  buildVersion:process.argv[2],processId:process.pid
 })));
 process.once('disconnect',()=>server.close());
 server.listen(0,'127.0.0.1',()=>process.send(server.address().port));
}else{
 const [actual,expected]=process.argv.slice(2);
 const child=fork(new URL(import.meta.url),[actual],{stdio:['ignore','ignore','ignore','ipc']});
 const closed=once(child,'close');
 const startup=AbortSignal.timeout(5000);
 try{
  const [port]=await once(child,'message',{signal:startup});
  await waitForInstalledRelease(expected,child.pid,{port,timeoutMs:3000,assertActive:async()=>{
   if(child.exitCode!==null||child.signalCode!==null)throw Error('Fixture exited.');
  }});
 }catch(error){
  if(!error.message.includes('does not match'))console.error(error.message);
  process.exitCode=error.message.includes('does not match')?2:1;
 }finally{
  child.kill();
  await closed;
 }
}
