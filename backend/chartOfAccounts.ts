import type {Pool,PoolClient} from 'pg';
import {ledgerAccountKinds,type LedgerAccountKind} from './generalLedger';

export const wholesaleAccounts:ReadonlyArray<readonly [string,string,LedgerAccountKind]>=[
 ['1000','Office Cash','Asset'],['1100','Bank Accounts','Asset'],
 ['1150','Representative Cash','Asset'],['1200','Customer Receivables','Asset'],
 ['1300','Inventory','Asset'],['1400','Cheques Receivable','Asset'],
 ['1500','Fixed Assets','Asset'],['2000','Supplier Payables','Liability'],
 ['2100','Loans Payable','Liability'],['2200','Taxes Payable','Liability'],
 ['3000','Partner Capital','Equity'],['3100','Retained Earnings','Equity'],
 ['4000','Wholesale Sales','Revenue'],['5000','Cost of Goods Sold','Expense'],
 ['5100','Operating Expenses','Expense'],['5200','Staff Salaries','Expense']
];

type Account={code:string;name:string;kind:LedgerAccountKind;active:boolean};

function identity(shopId:string,actor:string){
 if(typeof shopId!=='string'||!shopId.trim()||typeof actor!=='string'||!actor.trim())throw Error('Shop and authenticated actor required.');
}
function validate(account:Account){
 if(!account||typeof account.code!=='string'||!/^\d{4,10}$/.test(account.code)||typeof account.name!=='string'||!account.name.trim()||account.name.trim().length>160||!ledgerAccountKinds.includes(account.kind)||typeof account.active!=='boolean')throw Error('Valid account code, name, classification and status required.');
 return {...account,name:account.name.trim()};
}
async function audit(db:PoolClient,shopId:string,actor:string,previous:Account|null,next:Account){
 await db.query('INSERT INTO ars_gl_account_audit(shop_id,account_code,actor,previous_value,new_value) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[shopId,next.code,actor,previous?JSON.stringify(previous):null,JSON.stringify(next)]);
}
async function transaction<T>(db:Pool,fn:(client:PoolClient)=>Promise<T>){
 const client=await db.connect();
 try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function listLedgerAccounts(db:Pool|PoolClient,shopId:string){
 if(!shopId?.trim())throw Error('Shop required.');
 return (await db.query('SELECT code,name,kind,active FROM ars_gl_accounts WHERE shop_id=$1 ORDER BY code',[shopId])).rows;
}

export async function createLedgerAccount(db:Pool,shopId:string,actor:string,input:Account){
 identity(shopId,actor);const account=validate(input);
 return transaction(db,async client=>{
  const result=await client.query('INSERT INTO ars_gl_accounts(shop_id,code,name,kind,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING code',[shopId,account.code,account.name,account.kind,account.active]);
  if(!result.rowCount)throw Error('Account code already exists.');
  await audit(client,shopId,actor,null,account);return account;
 });
}

/** Names and status may change; code and classification never change. */
export async function updateLedgerAccount(db:Pool,shopId:string,actor:string,input:Account){
 identity(shopId,actor);const account=validate(input);
 return transaction(db,async client=>{
  const result=await client.query('SELECT code,name,kind,active FROM ars_gl_accounts WHERE shop_id=$1 AND code=$2 FOR UPDATE',[shopId,account.code]);
  if(!result.rowCount)throw Error('Account not found in this shop.');
  const previous=result.rows[0] as Account;
  if(previous.kind!==account.kind)throw Error('Account classification is immutable; create a new account.');
  if(previous.name===account.name&&previous.active===account.active)return previous;
  await client.query('UPDATE ars_gl_accounts SET name=$3,active=$4 WHERE shop_id=$1 AND code=$2',[shopId,account.code,account.name,account.active]);
  await audit(client,shopId,actor,previous,account);return account;
 });
}

/** Explicit setup action only. Existing codes are skipped, never overwritten. */
export async function seedWholesaleAccounts(db:Pool,shopId:string,actor:string){
 identity(shopId,actor);
 return transaction(db,async client=>{
  let created=0;
  const skipped:string[]=[];
  for(const [code,name,kind] of wholesaleAccounts){
   const result=await client.query('INSERT INTO ars_gl_accounts(shop_id,code,name,kind) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING code',[shopId,code,name,kind]);
   if(result.rowCount){await audit(client,shopId,actor,null,{code,name,kind,active:true});created++;}
   else skipped.push(code);
  }
  return {created,skipped};
 });
}

export async function ledgerAccountAudit(db:Pool|PoolClient,shopId:string,code:string){
 if(!shopId?.trim()||!/^\d{4,10}$/.test(code))throw Error('Shop and account code required.');
 return (await db.query('SELECT revision,actor,previous_value,new_value,recorded_at FROM ars_gl_account_audit WHERE shop_id=$1 AND account_code=$2 ORDER BY revision DESC LIMIT 100',[shopId,code])).rows;
}
