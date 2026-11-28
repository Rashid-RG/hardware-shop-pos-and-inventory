// Read-only database fingerprint helper; caller owns the transaction and its lifetime.
import {createHash} from 'node:crypto';
export async function fingerprintPublicTables(client){
 await client.query("SET LOCAL TIME ZONE 'UTC'");
 await client.query("SET LOCAL DateStyle='ISO, YMD'");
 await client.query("SET LOCAL extra_float_digits=3");
 await client.query("SET LOCAL bytea_output='hex'");
 const {rows}=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE \"C\"");
 const result=Object.create(null);
 for(const {tablename} of rows){
  const quoted='"'+tablename.replaceAll('"','""')+'"';
  const hash=createHash('sha256');
  let count=0;
  await client.query('DECLARE ars_fingerprint_cursor NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS value FROM public.'+quoted+' t ORDER BY row_to_json(t)::text COLLATE "C"');
  try{
   for(;;){
    const batch=await client.query('FETCH FORWARD 256 FROM ars_fingerprint_cursor');
    if(!batch.rows.length)break;
    for(const {value} of batch.rows){hash.update(value+'\n','utf8');count++;}
   }
  }finally{await client.query('CLOSE ars_fingerprint_cursor');}
  result[tablename]={rows:count,sha256:hash.digest('hex')};
 }
 return result;
}
export function assertFingerprintMatch(expected,actual){
 const names=Object.keys(expected).sort();
 if(!names.length||JSON.stringify(names)!==JSON.stringify(Object.keys(actual).sort()))throw Error('Restored table set differs.');
 for(const name of names){
  const a=expected[name],b=actual[name];
  if(!Number.isSafeInteger(a?.rows)||a.rows<0||!/^[a-f0-9]{64}$/.test(a.sha256)||a.rows!==b?.rows||a.sha256!==b.sha256)throw Error('Restored table fingerprint differs.');
 }
}
