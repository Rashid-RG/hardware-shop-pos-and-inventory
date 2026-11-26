// Compose verified database ownership and private IPC in a disposable rehearsal.
// Never starts the application, clears maintenance evidence, or grants live startup.
import {assertGateOwner} from './database-handoff-gate.mjs';
import {rehearsePrivateHandoff} from './database-handoff-ipc.mjs';
import {inspectHandoffLifecycle} from './database-handoff-lifecycle.mjs';
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export async function rehearseControlledStartup({directory,observer,owner,binding}){
 const check=async()=>{
  const state=await inspectHandoffLifecycle(directory);
  if(state.state!=='verified'||state.activationAllowed!==false)throw Error('Verified rehearsal journal required.');
  const path=join(directory,'handoff-pending.json');
  const stat=await lstat(path);
  if(!stat.isFile()||stat.size>8192)throw Error('Invalid maintenance marker.');
  const raw=await readFile(path,'utf8');
  const record=JSON.parse(raw);
  if(record.id!==state.id||record.activationAllowed!==false||!['releaseDigest','runtimeDigest','maintenanceDigest'].every(k=>record[k]===binding?.[k]))throw Error('Maintenance binding mismatch.');
  await assertGateOwner(observer,owner);
  return createHash('sha256').update(raw).digest('hex');
 };
 const initial=await check();
 const result=await rehearsePrivateHandoff({...binding,purpose:'candidate'});
 if(result.authorizationVerified!==true||result.liveStartupAllowed!==false)throw Error('Private rehearsal failed.');
 if(await check()!==initial)throw Error('Maintenance evidence changed.');
 return {authorizationVerified:true,ownershipObservedBeforeAndAfter:true,maintenanceRetained:true,liveStartupAllowed:false};
}
