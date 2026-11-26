// Readiness-only protocol: a separate gate excludes maintenance and startup
// transitions while the application writer lease is exchanged. No production
// caller is enabled until the complete lifecycle has been validated.
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
