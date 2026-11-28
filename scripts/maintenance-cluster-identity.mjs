// Read-only PostgreSQL identity evidence from the caller's protected session.
// Keep system_identifier as text: PostgreSQL identifiers exceed JS safe integers.
const supported=['hardware_pos','hardware_pos_ars'];
export function normalizeMaintenanceClusterIdentity(row,expectedDatabase){
 if(!supported.includes(expectedDatabase)||row?.database!==expectedDatabase||typeof row.system_identifier!=='string'||!/^[1-9][0-9]{0,19}$/.test(row.system_identifier)||BigInt(row.system_identifier)>18446744073709551615n||typeof row.database_oid!=='string'||!/^[1-9][0-9]{0,9}$/.test(row.database_oid)||BigInt(row.database_oid)>4294967295n)throw Error('Invalid maintenance cluster identity.');
 return Object.freeze({database:expectedDatabase,systemIdentifier:row.system_identifier,databaseOid:row.database_oid});
}
export function assertMaintenanceClusterMatch(expected,actual){
 if(!expected||!actual||!supported.includes(expected.database)||expected.database!==actual.database||expected.systemIdentifier!==actual.systemIdentifier||expected.databaseOid!==actual.databaseOid)throw Error('PostgreSQL cluster identity mismatch.');
}
export async function readProtectedMaintenanceClusterIdentity(client,scope){
 const database=scope?.owner?.database;
 if(!supported.includes(database)||typeof scope.assertActive!=='function'||!scope.signal||typeof client?.query!=='function')throw Error('Protected cluster identity scope required.');
 const check=async()=>{await scope.assertActive();if(scope.signal.aborted||scope.owner.database!==database)throw Error('Maintenance interrupted.');};
 await check();
 const result=await client.query("SELECT current_database() AS database, system_identifier::text AS system_identifier, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid FROM pg_control_system()");
 if(result.rows?.length!==1)throw Error('Unique maintenance cluster identity required.');
 const identity=normalizeMaintenanceClusterIdentity(result.rows[0],database);
 if(String(scope.owner.databaseOid)!==identity.databaseOid)throw Error('Protected database identity mismatch.');
 await check();
 return identity;
}
