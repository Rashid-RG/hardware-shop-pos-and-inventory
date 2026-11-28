import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {bindActivationIncidentReview,assertSameActivationIncidentReview} from '../scripts/activation-incident-review-binding.mjs';
import {observeAuthenticatedActivationReview} from '../scripts/activation-incident-authenticated-review.mjs';

const flags={activationAllowed:false,runtimeActivated:false,startupAllowed:false,rollbackAllowed:false};
const expected={database:'hardware_pos_ci',systemIdentifier:'123456789',databaseOid:'12345'};
const configurationBytes=Buffer.from('DATABASE_URL=postgresql://localhost/hardware_pos_ci\n');
const bindingBytes=Buffer.from(JSON.stringify({schema:1,...expected,activationAllowed:false}));
const digest=b=>createHash('sha256').update(b).digest('hex');
const hex='a'.repeat(64);
function fixture(platform='mint'){
 const common={schema:1,candidateVersion:'1.2.3',...flags};
 const snapshot=platform==='mint'?
 {...common,desktopUid:1000,recoveryFolder:'/tmp/recovery',previousProject:'/tmp/old',backupHoldBindingVerified:true,continuousExclusionVerified:false,evidence:{hold:hex,binding:digest(bindingBytes),configuration:digest(configurationBytes),recovery:hex,restore:hex,protectedBackup:hex}}:
 {...common,userSid:'S-1-5-21-1234',recoveryId:'1.2.3-'+'a'.repeat(32),helperHash:hex,evidence:{maintenance:hex,shutdown:hex,binding:digest(bindingBytes),runtimePreparation:hex,runtimeConfiguration:digest(configurationBytes),recovery:hex,rollback:hex}};
 return {schema:1,kind:platform+'-activation-incident-review',incidentDigest:hex,incidentRetained:true,administratorApprovalRequired:true,continuousExclusionVerified:false,recoveryAllowed:false,...flags,snapshot};
}
test('both native review shapes bind deterministically and reject changed evidence',()=>{
 for(const platform of ['mint','windows']){
  const first=fixture(platform),second=structuredClone(first);
  assert.equal(bindActivationIncidentReview(first).reviewDigest,assertSameActivationIncidentReview(first,second).reviewDigest);
  second.snapshot.evidence.recovery='b'.repeat(64);
  assert.throws(()=>assertSameActivationIncidentReview(first,second),/changed/);
  second.activationAllowed=true;
  assert.throws(()=>bindActivationIncidentReview(second));
  const incomplete=fixture(platform);delete incomplete.snapshot.evidence.binding;
  assert.throws(()=>bindActivationIncidentReview(incomplete));
 }
});
const operator={email:'operator@example.invalid',password:'fixture-password-1'};
const reviewer={email:'reviewer@example.invalid',password:'fixture-password-2'};
async function fakeClient(){
 const rows=await Promise.all([operator,reviewer].map(async (c,i)=>({id:'admin-'+i,email:c.email,role:'Super Admin',password_hash:await bcrypt.hash(c.password,4),revision:'2026-01-01 00:00:00+00'})));
 return {async query(sql,args){
  if(sql.startsWith('SELECT current_database'))return {rows:[{database:expected.database,system_identifier:expected.systemIdentifier,database_oid:expected.databaseOid,read_only:true,snapshot:true}]};
  if(sql.startsWith('SELECT id,email'))return {rows:rows.filter(r=>r.email===args[0])};
  if(sql.startsWith('BEGIN')||sql.startsWith('SET LOCAL')||sql==='ROLLBACK')return {rows:[]};
  throw Error('Unexpected SQL');
 }};
}
async function options(platform='mint'){
 return {client:await fakeClient(),expected,configurationBytes,bindingBytes,readReview:async()=>fixture(platform),operator,reviewer,confirmation:'REVIEW ACTIVATION INCIDENT'};
}
test('dual administrator observation is evidence-bound and cannot authorize activation',async()=>{
 for(const platform of ['mint','windows']){
  const result=await observeAuthenticatedActivationReview(await options(platform));
  assert.equal(result.distinctAccountsVerified,true);
  assert.notEqual(result.operator.id,result.reviewer.id);
  assert.equal(result.observationOnly,true);
  for(const flag of [...Object.keys(flags),'recoveryAllowed','continuousExclusionVerified','independenceVerified'])assert.equal(result[flag],false);
  assert.equal(JSON.stringify(result).includes(operator.password),false);
  assert.equal(JSON.stringify(result).includes(reviewer.password),false);
 }
});
test('rejects same account, wrong password, mismatched configuration and stale evidence',async()=>{
 const input=await options();
 await assert.rejects(observeAuthenticatedActivationReview({...input,reviewer:operator}),/denied/);
 await assert.rejects(observeAuthenticatedActivationReview({...input,reviewer:{...reviewer,password:'incorrect'}}),/denied/);
 await assert.rejects(observeAuthenticatedActivationReview({...input,configurationBytes:Buffer.from('OTHER=1')}),/evidence mismatch/);
 let calls=0;
 await assert.rejects(observeAuthenticatedActivationReview({...input,readReview:async()=>{const r=fixture();if(calls++)r.snapshot.evidence.recovery='b'.repeat(64);return r;}}),/changed/);
});

test('durable observations reject duplicates, stale credentials and modified evidence',async()=>{
 const {mkdtemp,readFile,readdir,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {recordActivationIncidentObservation,revalidateActivationIncidentObservation}=await import('../scripts/activation-incident-review-record.mjs');
 const directory=await mkdtemp(join(tmpdir(),'ars-activation-review-'));
 try{
  const input=await options();
  const confirmation='RETAIN ACTIVATION REVIEW OBSERVATION';
  const first=await recordActivationIncidentObservation(directory,input,confirmation);
  assert.equal(first.state,'activation-observation-retained');
  assert.equal(first.startupAllowed,false);
  const files=await readdir(directory);
  assert.equal(files.length,1);
  const path=join(directory,files[0]),raw=await readFile(path);
  assert.equal(raw.includes(operator.password),false);
  assert.equal(raw.includes(reviewer.password),false);
  assert.equal(digest(raw),first.recordDigest);
  const matched=await revalidateActivationIncidentObservation(directory,input);
  assert.equal(matched.state,'activation-observation-matched');
  assert.equal(matched.recordDigest,first.recordDigest);
  assert.equal(matched.recoveryAllowed,false);
  await assert.rejects(recordActivationIncidentObservation(directory,input,confirmation),{code:'EEXIST'});
  await assert.rejects(revalidateActivationIncidentObservation(directory,{...input,reviewer:{...reviewer,password:'wrong'}}),/denied/);
  const changed=JSON.parse(raw.toString());
  changed.operator.revisionDigest='b'.repeat(64);
  await writeFile(path,JSON.stringify(changed));
  await assert.rejects(revalidateActivationIncidentObservation(directory,input),/stale/);
  changed.startupAllowed=true;
  await writeFile(path,JSON.stringify(changed));
  await assert.rejects(revalidateActivationIncidentObservation(directory,input),/Invalid observation/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('native authentication session is closed before the second evidence inspection',async()=>{
 const input=await options();
 const client=input.client;
 delete input.client;
 let connected=false,observations=0;
 const result=await observeAuthenticatedActivationReview({...input,
  readReview:async()=>{assert.equal(connected,false);observations++;return fixture();},
  openClient:async()=>{assert.equal(observations,1);connected=true;return {...client,end:async()=>{connected=false;}};}
 });
 assert.equal(observations,2);
 assert.equal(connected,false);
 assert.equal(result.activationAllowed,false);
});

test('native recovery identifier validation matches actual platform archive names',async()=>{
 const {validNativeRecoveryId}=await import('../scripts/activation-incident-native-review.mjs');
 const id='a'.repeat(32),mint='1.0.0-ars-mint-20261127T030000Z-'+id;
 assert.equal(validNativeRecoveryId(mint+'-v2-with-uploads','linux'),true);
 assert.equal(validNativeRecoveryId(mint+'-database-only','linux'),true);
 assert.equal(validNativeRecoveryId('1.0.0-'+id,'win32'),true);
 assert.equal(validNativeRecoveryId('1.0.0-'+id,'linux'),false);
 assert.equal(validNativeRecoveryId(mint+'-v2-with-uploads','win32'),false);
 for(const bad of ['../'+mint+'-v2-with-uploads',mint+'-v2-with-uploads/..',mint+'-v2-with-uploads.dump','',null])assert.equal(validNativeRecoveryId(bad,'linux'),false);
});
