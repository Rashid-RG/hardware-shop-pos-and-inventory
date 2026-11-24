import type {Pool,PoolClient} from 'pg';

export const controlMappings={
 supplierAdvances:'Asset',receivables:'Asset',inventory:'Asset',cheques:'Asset',fixedAssets:'Asset',
 supplierPayables:'Liability',customerCredits:'Liability',loans:'Liability',tax:'Liability',
 capital:'Equity',retainedEarnings:'Equity',sales:'Revenue',costOfGoods:'Expense',
 operatingExpense:'Expense',salary:'Expense'
} as const;
type Kind=keyof typeof controlMappings|'financialAccount';
type Mapping={kind:Kind;sourceId:string;accountCode:string;evidence:string};

export async function listLedgerMappings(db:Pool|PoolClient,shopId:string){
 if(!shopId?.trim())throw Error('Shop required.');
 return (await db.query(`SELECT m.mapping_kind AS kind,m.source_id AS "sourceId",m.account_code AS "accountCode",
 m.evidence,m.recorded_by,m.recorded_at,a.name,a.kind AS "accountKind",a.active
 FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code
 WHERE m.shop_id=$1 ORDER BY m.mapping_kind,m.source_id`,[shopId])).rows;
}
export async function createLedgerMapping(db:Pool,shopId:string,actor:string,input:Mapping){
 if(!shopId?.trim()||!actor?.trim()||!input||typeof input.kind!=='string'||(input.kind!=='financialAccount'&&!Object.prototype.hasOwnProperty.call(controlMappings,input.kind))||typeof input.sourceId!=='string'||!input.sourceId.trim()||input.sourceId.length>160||typeof input.accountCode!=='string'||!/^\d{4,10}$/.test(input.accountCode)||typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.trim().length>500)throw Error('Valid account mapping and evidence required.');
 const source=input.sourceId.trim(),evidence=input.evidence.trim();
 if(input.kind!=='financialAccount'&&source!=='control')throw Error('Control mappings require the control source identifier.');
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ars-gl-mappings:'+shopId]);
  const previous=(await client.query('SELECT account_code,evidence,recorded_by FROM ars_gl_account_mappings WHERE shop_id=$1 AND mapping_kind=$2 AND source_id=$3',[shopId,input.kind,source])).rows[0];
  if(previous){
   if(previous.account_code!==input.accountCode||previous.evidence!==evidence||previous.recorded_by!==actor)throw Error('Mapping already exists; audited correction required.');
   await client.query('COMMIT');return {replayed:true};
  }
  if((await client.query('SELECT 1 FROM ars_gl_cutover WHERE shop_id=$1 AND posting_enabled',[shopId])).rowCount)throw Error('Active accounting requires an audited mapping amendment.');
  let expected:string;
  if(input.kind==='financialAccount'){
   const a=(await client.query('SELECT kind,active FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 FOR SHARE',[shopId,source])).rows[0];
   if(!a||!a.active||!['Office Cash','Bank','Representative Cash'].includes(a.kind))throw Error('Active cash, bank or representative account required.');
   expected='Asset';
  }else expected=controlMappings[input.kind];
  const target=(await client.query('SELECT kind,active FROM ars_gl_accounts WHERE shop_id=$1 AND code=$2 FOR SHARE',[shopId,input.accountCode])).rows[0];
  if(!target||!target.active||target.kind!==expected)throw Error('Active ledger account with matching classification required.');
  if((await client.query('SELECT 1 FROM ars_gl_account_mappings WHERE shop_id=$1 AND account_code=$2',[shopId,input.accountCode])).rowCount)throw Error('Use a distinct ledger account for each mapping.');
  await client.query('INSERT INTO ars_gl_account_mappings(shop_id,mapping_kind,source_id,account_code,evidence,recorded_by) VALUES($1,$2,$3,$4,$5,$6)',[shopId,input.kind,source,input.accountCode,evidence,actor]);
  await client.query('COMMIT');return {replayed:false};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
