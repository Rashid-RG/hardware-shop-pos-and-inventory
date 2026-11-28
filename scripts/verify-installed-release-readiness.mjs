// Read-only readiness check for the process started by the local updater.
import {pathToFileURL} from 'node:url';

export async function verifyInstalledRelease(version, pid, port=3000){
 if(typeof version!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(version)||
    !Number.isSafeInteger(pid)||pid<1||!Number.isInteger(port)||port<1||port>65535){
  throw Error('Expected release version, process ID and valid local port required.');
 }
 const response=await fetch('http://127.0.0.1:'+port+'/api/ready',
  {redirect:'error',signal:AbortSignal.timeout(3000)});
 if(!response.ok)throw Error('POS reported that it is not ready.');
 const result=await response.json();
 if(result?.ok!==true||result.status!=='ready'||result.database!=='reachable'||
    result.sourceOfTruth!=='normalized'||result.buildVersion!==version||result.processId!==pid){
  throw Error('Readiness does not match the expected POS process and release.');
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==4)throw Error('Usage: node verify-installed-release-readiness.mjs VERSION PID');
  await verifyInstalledRelease(process.argv[2],Number(process.argv[3]));
  console.log('Expected POS release and process are ready.');
 }catch(error){
  console.error(error.message);
  process.exitCode=1;
 }
}
