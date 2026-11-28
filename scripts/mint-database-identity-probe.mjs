// Read-only host probe for the Mint database registration workflow.
import {readFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import pg from 'pg';
import {localConnectionConfig} from './writer-loss-offline-diagnostics.mjs';
let client;
try{
 const options=localConnectionConfig(dotenv.parse(await readFile(process.argv[2])).DATABASE_URL);
 if(options.database!=='hardware_pos_ars'||options.port!==5434)throw Error('Invalid Mint database.');
 client=new pg.Client(options);
 await client.connect();
 const {rows}=await client.query("SELECT system_identifier::text || ':' || (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS identity FROM pg_control_system()");
 if(rows.length!==1||!/^[0-9]{1,20}:[0-9]{1,10}$/.test(rows[0].identity))throw Error('Invalid identity.');
 console.log(rows[0].identity);
}catch{process.stderr.write('Mint identity probe failed.\n');process.exitCode=1;}
finally{if(client)await client.end().catch(()=>{});}
