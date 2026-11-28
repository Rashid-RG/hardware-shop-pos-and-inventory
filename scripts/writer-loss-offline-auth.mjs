// Offline dual-account credential check. Does not issue tokens or authorize recovery.
import bcrypt from 'bcryptjs';
import {createHash} from 'node:crypto';
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,independenceVerified:false};
const normalized=v=>typeof v==='string'?v.trim().toLowerCase():'';
export function globalRecoveryPolicy(email,config){
 if(!config||typeof config!=='object')return false;
 if(String(config.SUPER_ADMIN_ALLOWED_SHOPS??'').split(',').some(x=>x.trim()))return false;
 for(const entry of String(config.USER_FIXED_SHOPS??'').split(',').map(x=>x.trim()).filter(Boolean)){
  const i=entry.indexOf('=');
  if(i<=0||!entry.slice(i+1).trim())return false;
  if(normalized(entry.slice(0,i))===normalized(email))return false;
 }
 return true;
}
function credentialValid(c){return typeof c?.email==='string'&&normalized(c.email).length>0&&c.email.length<=254&&typeof c.password==='string'&&Buffer.byteLength(c.password,'utf8')>=1&&Buffer.byteLength(c.password,'utf8')<=72;}
export async function verifyOfflineRecoveryPair(client,expected,config,operator,reviewer){
 let begun=false;
 try{
  if(!['hardware_pos','hardware_pos_ars','hardware_pos_ci'].includes(expected?.database)||!/^[0-9]{1,20}$/.test(expected?.systemIdentifier??'')||!/^[0-9]{1,10}$/.test(expected?.databaseOid??'')||!credentialValid(operator)||!credentialValid(reviewer)||normalized(operator.email)===normalized(reviewer.email)||!globalRecoveryPolicy(operator.email,config)||!globalRecoveryPolicy(reviewer.email,config))throw Error('Not eligible.');
  // Also honor any stricter process-level scope; never use it to relax file policy.
  if(!globalRecoveryPolicy(operator.email,process.env)||!globalRecoveryPolicy(reviewer.email,process.env))throw Error('Not eligible.');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  await client.query("SET LOCAL statement_timeout='5000ms'");
  const identity=await client.query("SELECT current_database() AS database,system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('transaction_read_only')='on' AS read_only,current_setting('transaction_isolation')='repeatable read' AS snapshot FROM pg_control_system()");
  const a=identity.rows[0];
  if(identity.rows.length!==1||a.database!==expected.database||a.system_identifier!==expected.systemIdentifier||a.database_oid!==expected.databaseOid||a.read_only!==true||a.snapshot!==true)throw Error('Identity mismatch.');
  const accounts=[];
  for(const credential of [operator,reviewer]){
   const result=await client.query("SELECT id,email,role,password_hash,updated_at::text AS revision FROM users WHERE lower(email)=$1 LIMIT 2",[normalized(credential.email)]);
   const row=result.rows[0];
   if(result.rows.length!==1||typeof row.id!=='string'||!row.id||normalized(row.email)!==normalized(credential.email)||row.role!=='Super Admin'||!globalRecoveryPolicy(row.email,config)||!globalRecoveryPolicy(row.email,process.env)||typeof row.revision!=='string'||! /^\$2[aby]\$(0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}$/.test(row.password_hash??'')||!await bcrypt.compare(credential.password,row.password_hash))throw Error('Not eligible.');
   accounts.push({id:row.id,revisionDigest:createHash('sha256').update(JSON.stringify([row.id,row.email,row.role,row.revision,row.password_hash])).digest('hex')});
  }
  if(accounts[0].id===accounts[1].id)throw Error('Distinct accounts required.');
  await client.query('ROLLBACK');begun=false;
  return {state:'distinct-admin-credentials-verified',operator:accounts[0],reviewer:accounts[1],credentialsVerified:true,distinctAccountsVerified:true,...blocked};
 }catch{return {state:'offline-authentication-denied',credentialsVerified:false,distinctAccountsVerified:false,...blocked};}
 finally{if(begun)await client.query('ROLLBACK').catch(()=>{});}
}
