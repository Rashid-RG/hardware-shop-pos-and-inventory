// Shared startup/maintenance gate. Full release-switch handoff remains disabled.
export const HANDOFF_CLASS=1642958133;
export const HANDOFF_ID=2;
export const WRITER_ID=1;
export async function acquireHandoffGate(client) {
 const result=await client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[HANDOFF_CLASS,HANDOFF_ID]);
 if(result.rows[0]?.acquired!==true) throw new Error('Database handoff gate is already held.');
}
export async function releaseHandoffGate(client) {
 const result=await client.query('SELECT pg_advisory_unlock($1::integer,$2::integer) AS released',[HANDOFF_CLASS,HANDOFF_ID]);
 if(result.rows[0]?.released!==true) throw new Error('Database handoff gate release not verified.');
}

// Observational proof from the same database, not authorization to bypass the gate.
// Backend start is retained as text to avoid losing PostgreSQL microsecond precision.
export async function captureGateOwner(client){
 const result=await client.query("SELECT pg_backend_pid() AS pid, backend_start::text AS started FROM pg_stat_activity WHERE pid=pg_backend_pid()");
 const row=result.rows[0];
 if(result.rows.length!==1||!Number.isSafeInteger(row?.pid)||row.pid<=0||typeof row.started!=='string'||!row.started)throw Error('Coordinator identity unavailable.');
 const owner={pid:row.pid,started:row.started};
 await assertGateOwner(client,owner);
 return Object.freeze(owner);
}
export async function assertGateOwner(client,owner,{lockClass=HANDOFF_CLASS,lockId=HANDOFF_ID}={}){
 if(!Number.isSafeInteger(owner?.pid)||owner.pid<=0||typeof owner.started!=='string'||!owner.started||owner.started.length>128)throw Error('Invalid coordinator identity.');
 const result=await client.query(
  "SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND l.classid=$1::oid AND l.objid=$2::oid AND l.objsubid=2 AND l.mode='ExclusiveLock' AND l.granted AND l.pid=$3::integer AND a.backend_start=$4::timestamptz AND a.datname=current_database()) AS owned",
  [lockClass,lockId,owner.pid,owner.started]
 );
 if(result.rows[0]?.owned!==true)throw Error('Coordinator gate ownership not verified.');
}
