import type {Client} from 'pg';
import {parsePackagingDraft} from './packagingDrafts';
import {moneyCents} from './generalLedger';
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,physicalStockVerified:false} as const;
type Product={quantity:unknown;cost_price:unknown;variants_json:unknown;shared_stock_units:unknown};
function quantity(v:unknown){
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>2147483647)throw Error('Invalid quantity.');
 return BigInt(v);
}
function value(q:bigint,c:unknown){
 if(typeof c!=='number'&&typeof c!=='string')throw Error('Invalid unit cost.');
 const cents=moneyCents(String(c));
 if(q>0n&&cents===0n)throw Error('Missing cost.');
 return q*cents;
}
export function recoveryProductValue(p:Product){
 const q=quantity(p.quantity);
 const variants=p.variants_json??[];
 if(!Array.isArray(variants)||variants.length>1000)throw Error('Invalid variants.');
 if(p.shared_stock_units!=null){
  if(variants.length)throw Error('Mixed stock modes.');
  const config=parsePackagingDraft(p.shared_stock_units);
  if(config.units.filter(u=>u.baseUnits===1).length!==1)throw Error('Ambiguous base unit.');
  return value(q,p.cost_price);
 }
 if(!variants.length)return value(q,p.cost_price);
 let sum=0n,total=0n;
 const ids=new Set<string>();
 for(const v of variants){
  if(!v||typeof v.id!=='string'||!v.id.trim()||ids.has(v.id))throw Error('Invalid variant ID.');
  ids.add(v.id);
  const n=quantity(v.quantity);
  sum+=n;total+=value(n,v.costPrice);
 }
 if(sum!==q)throw Error('Variant quantity mismatch.');
 return total;
}
export async function inspectRecoveryInventory(client:Client,expected:{database:string;systemIdentifier:string;databaseOid:string}){
 let begun=false;
 try{
  if(!['hardware_pos','hardware_pos_ars','hardware_pos_ci'].includes(expected?.database)||!/^[0-9]{1,20}$/.test(expected?.systemIdentifier??'')||!/^[0-9]{1,10}$/.test(expected?.databaseOid??''))throw Error('Trusted identity required.');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  await client.query("SET LOCAL statement_timeout='10000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  const r=await client.query("SELECT current_database() AS database,system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('transaction_read_only')='on' AS read_only,current_setting('transaction_isolation')='repeatable read' AS snapshot FROM pg_control_system()");
  const a=r.rows[0];
  if(r.rows.length!==1||a.database!==expected.database||a.system_identifier!==expected.systemIdentifier||a.database_oid!==expected.databaseOid||a.read_only!==true||a.snapshot!==true)throw Error('Identity mismatch.');
  const products=(await client.query("SELECT shop_id,quantity,cost_price,variants_json,shared_stock_units FROM products ORDER BY id LIMIT 10001")).rows;
  if(products.length>10000)throw Error('Inventory inspection capacity exceeded.');
  const totals=new Map<string,bigint>();
  let exceptions=0;
  for(const p of products){
   if(typeof p.shop_id!=='string'||!p.shop_id.trim())throw Error('Invalid shop.');
   if(!totals.has(p.shop_id))totals.set(p.shop_id,0n);
   try{totals.set(p.shop_id,totals.get(p.shop_id)!+recoveryProductValue(p));}catch{exceptions++;}
  }
  const controls=(await client.query("SELECT m.shop_id,a.active,a.kind,g.posting_enabled,(SELECT count(*)::int FROM ars_gl_account_mappings x WHERE x.shop_id=m.shop_id AND x.account_code=m.account_code) AS mapping_count,coalesce((SELECT sum(l.debit-l.credit) FROM ars_gl_lines l WHERE l.shop_id=m.shop_id AND l.account_code=m.account_code),0)::text AS balance FROM ars_gl_account_mappings m LEFT JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code LEFT JOIN ars_gl_cutover g ON g.shop_id=m.shop_id WHERE m.mapping_kind='inventory' AND m.source_id='control' LIMIT 101")).rows;
  if(controls.length>100)throw Error('Control capacity exceeded.');
  for(const c of controls)if(!totals.has(c.shop_id))totals.set(c.shop_id,0n);
  let differences=0,unmapped=0,matched=0;
  for(const [shop,total] of totals){
   const rows=controls.filter(c=>c.shop_id===shop);
   const c=rows[0];
   if(rows.length!==1||c.active!==true||c.kind!=='Asset'||c.posting_enabled!==true||c.mapping_count!==1){unmapped++;continue;}
   const raw=String(c.balance),negative=raw.startsWith('-');
   const amount=moneyCents(negative?raw.slice(1):raw)*(negative?-1n:1n);
   if(amount===total)matched++;else differences++;
  }
  await client.query('ROLLBACK');begun=false;
  return {state:!totals.size?'no-coverage':exceptions||differences||unmapped?'inventory-review-required':'recorded-inventory-estimates-match',productsInspected:products.length,invalidProducts:exceptions,shopsWithDifferences:differences,shopsWithoutValidMapping:unmapped,shopsWithMatchingEstimate:matched,...blocked};
 }catch{return {state:'inventory-inspection-unavailable',...blocked};}
 finally{if(begun)await client.query('ROLLBACK').catch(()=>{});}
}
