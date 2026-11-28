// Read-only observations; never authorizes recovery or acquires application locks.
export async function inspectRecoveryDatabase(client,expected){
 const blocked={startupAllowed:false,recoveryAllowed:false};
 if(!/^[0-9]{1,20}$/.test(expected?.systemIdentifier??'')||!/^[0-9]{1,10}$/.test(expected?.databaseOid??'')||!['hardware_pos','hardware_pos_ars','hardware_pos_ci'].includes(expected?.database))throw Error('Invalid expected database identity.');
 try{
  const result=await client.query("SELECT current_database() AS database, system_identifier::text AS system_identifier, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid, current_setting('transaction_read_only')='on' AS read_only, (SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE') FROM pg_roles WHERE rolname=current_user) AS full_visibility FROM pg_control_system()");
  const row=result.rows[0];
  if(result.rows.length!==1||row?.database!==expected.database||row.system_identifier!==expected.systemIdentifier||row.database_oid!==expected.databaseOid||row.read_only!==true)return {state:'identity-or-readonly-mismatch',...blocked};
  if(row.full_visibility!==true)return {state:'insufficient-visibility',...blocked};
  const activity=await client.query("SELECT (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') AS other_sessions, (SELECT count(*)::integer FROM pg_prepared_xacts WHERE database=current_database()) AS prepared_transactions, (SELECT count(*)::integer FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=1642958133::oid AND objid IN (1::oid,2::oid,3::oid) AND objsubid=2 AND granted) AS application_locks");
  const a=activity.rows[0];
  if(activity.rows.length!==1||![a?.other_sessions,a?.prepared_transactions,a?.application_locks].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Invalid activity evidence.');
  const busy=a.other_sessions+a.prepared_transactions+a.application_locks>0;
  return {state:busy?'activity-detected':'no-activity-observed',identityMatched:true,otherSessions:a.other_sessions,preparedTransactions:a.prepared_transactions,applicationLocks:a.application_locks,continuousExclusionVerified:false,...blocked};
 }catch{return {state:'inspection-failed',...blocked};}
}
