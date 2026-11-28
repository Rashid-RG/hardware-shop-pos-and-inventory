import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

// An allocation is an approved accounting entry, NOT a bank transfer or a
// calculation of distributable profits from unverified inventory valuations.
export const initArsProfitLedger = async (pool:Pool)=>{
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ars_partner_profit_allocations(
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      approved_profit_lkr NUMERIC(16,2) NOT NULL CHECK(approved_profit_lkr > 0),
      approval_reference TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL,
      allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(shop_id,period_key)
    );
    CREATE TABLE IF NOT EXISTS ars_partner_ownership_agreements(
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      effective_period TEXT NOT NULL,
      approval_reference TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      shares JSONB NOT NULL,
      UNIQUE(shop_id,effective_period)
    );
    CREATE INDEX IF NOT EXISTS ars_partner_agreements_lookup_idx
      ON ars_partner_ownership_agreements(shop_id,effective_period DESC);
    CREATE TABLE IF NOT EXISTS ars_partner_profit_shares(
      allocation_id TEXT NOT NULL REFERENCES ars_partner_profit_allocations(id),
      partner_id TEXT NOT NULL REFERENCES ars_business_partners(id),
      ownership_basis_points INTEGER NOT NULL CHECK(ownership_basis_points>=0 AND ownership_basis_points<=10000),
      allocated_lkr NUMERIC(16,2) NOT NULL CHECK(allocated_lkr>=0),
      PRIMARY KEY(allocation_id,partner_id)
    );
  `);
};

export type OwnershipAgreementShare={partnerId:string;ownershipPercent:number};
export type OwnershipAgreementArgs={
  shopId:string;effectivePeriod:string;approvalReference:string;approvedBy:string;
  shares:OwnershipAgreementShare[];
};

// A whole agreement takes effect together; prior allocations are immutable.
export const recordArsOwnershipAgreement=async(pool:Pool,args:OwnershipAgreementArgs)=>{
  const {shopId,effectivePeriod,approvalReference,approvedBy,shares}=args;
  if(!shopId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectivePeriod)||
      approvalReference.trim().length<3||approvalReference.length>160||
      !approvedBy.trim()||!Array.isArray(shares)||shares.length<1)
    throw new Error('Valid effective accounting month, agreement reference and partner shares are required.');
  const ids=new Set<string>();
  const parsed=shares.map(share=>{
    const id=String(share?.partnerId||'').trim();
    const pct=Number(share?.ownershipPercent);
    const bp=Math.round(pct*100);
    if(!id||ids.has(id)||!Number.isFinite(pct)||pct<0||pct>100||
       Math.abs(pct*100-bp)>0.00001)
      throw new Error('Each active partner requires one valid ownership percentage.');
    ids.add(id);
    return {partnerId:id,ownershipBasisPoints:bp};
  });
  if(parsed.reduce((sum,share)=>sum+share.ownershipBasisPoints,0)!==10000)
    throw new Error('Ownership agreement shares must total exactly 100%.');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ars-profit-allocation'),hashtext($1))",[shopId]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[shopId+':ars-partners']);
    const partners=await client.query(
      'SELECT id,name FROM ars_business_partners WHERE shop_id=$1 AND is_active=TRUE ORDER BY id FOR UPDATE',[shopId]);
    if(partners.rows.length!==parsed.length ||
       partners.rows.some(p=>!ids.has(p.id)))
      throw new Error('Agreement must include every currently active partner exactly once.');
    const last=await client.query(
      'SELECT MAX(period_key) AS last_period FROM ars_partner_profit_allocations WHERE shop_id=$1',[shopId]);
    if(last.rows[0].last_period&&effectivePeriod<=last.rows[0].last_period)
      throw new Error('Agreement must begin after the latest approved profit allocation month.');
    const existing=await client.query(
      'SELECT id FROM ars_partner_ownership_agreements WHERE shop_id=$1 AND effective_period=$2',
      [shopId,effectivePeriod]);
    if(existing.rowCount)throw new Error('An ownership agreement already exists for this effective month.');
    const names=new Map<string,string>(partners.rows.map(p=>[p.id,p.name]));
    const frozen=parsed.map(share=>({...share,name:names.get(share.partnerId)}));
    const id='ownership-agreement-'+randomUUID();
    await client.query(
      `INSERT INTO ars_partner_ownership_agreements
        (id,shop_id,effective_period,approval_reference,approved_by,shares)
       VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [id,shopId,effectivePeriod,approvalReference.trim(),approvedBy,JSON.stringify(frozen)]);
    await client.query('COMMIT');
    return {id,effectivePeriod,shares:frozen};
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release();}
};

type ProfitAllocationArgs={
  shopId:string;periodKey:string;approvedProfitLkr:number;
  approvalReference:string;approvedBy:string;note?:string;
};

export const recordArsProfitAllocation=async(pool:Pool,args:ProfitAllocationArgs)=>{
  const {shopId,periodKey,approvedProfitLkr,approvalReference,approvedBy,note=''}=args;
  if(!shopId||!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)||
     !approvalReference.trim()||approvalReference.length>160||!approvedBy.trim()||
     note.length>1000||!Number.isFinite(approvedProfitLkr)||approvedProfitLkr<=0||
     approvedProfitLkr>1_000_000_000||Math.abs(approvedProfitLkr*100-Math.round(approvedProfitLkr*100))>0.00001)
    throw new Error('Valid accounting period, approved profit and approval document reference are required.');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ars-profit-allocation'),hashtext($1))",[shopId]);
    const agreements=await client.query(
      'SELECT shares FROM ars_partner_ownership_agreements WHERE shop_id=$1 AND effective_period<=$2 ORDER BY effective_period DESC LIMIT 1',
      [shopId,periodKey]);
    const legacyPartners=await client.query(
      'SELECT id,name,ownership_percent FROM ars_business_partners WHERE shop_id=$1 AND is_active=TRUE ORDER BY id FOR UPDATE',[shopId]);
    const agreementShares=agreements.rows[0]?.shares;
    const partners=agreements.rowCount
      ? {rows:(Array.isArray(agreementShares) ? agreementShares : []).map((share:any)=>({
          id:String(share.partnerId),name:String(share.name),
          ownership_percent:Number(share.ownershipBasisPoints)/100
        }))}
      : legacyPartners;
    if(!agreements.rowCount){
      const anyAgreement=await client.query(
        'SELECT 1 FROM ars_partner_ownership_agreements WHERE shop_id=$1 LIMIT 1',[shopId]);
      if(anyAgreement.rowCount)throw new Error('No ownership agreement covers this accounting period; backdated allocations require a reviewed agreement.');
    }
    if(!partners.rows.length)throw new Error('At least one partner is required for allocation.');
    if(agreements.rowCount){
      const activeIds=new Set(legacyPartners.rows.map(p=>p.id));
      if(activeIds.size!==partners.rows.length || partners.rows.some(p=>!activeIds.has(p.id)))
        throw new Error('Active partner roster changed; approve a new ownership agreement before allocating profit.');
    }
    const basisPoints=partners.rows.map(p=>{
      if(p.ownership_percent===null)throw new Error('All partners need ownership percentages.');
      const pct=Number(p.ownership_percent);
      const bp=Math.round(pct*100);
      if(!Number.isFinite(pct)||pct<0||pct>100||Math.abs(bp-pct*100)>0.00001)
        throw new Error('Partner ownership percentages must be valid to two decimal places.');
      return bp;
    });
    if(basisPoints.reduce((sum,n)=>sum+n,0)!==10000)
      throw new Error('Partner ownership percentages must total exactly 100%.');
    const existing=await client.query(
      'SELECT id FROM ars_partner_profit_allocations WHERE shop_id=$1 AND period_key=$2',[shopId,periodKey]);
    if(existing.rowCount)throw new Error('This accounting period already has a profit allocation.');
    const totalCents=Math.round(approvedProfitLkr*100);
    const whole=basisPoints.map(bp=>Math.floor(totalCents*bp/10000));
    let remainder=totalCents-whole.reduce((sum,n)=>sum+n,0);
    const ranking=basisPoints.map((bp,i)=>({i,frac:(totalCents*bp)%10000}))
      .sort((a,b)=>b.frac-a.frac||partners.rows[a.i].id.localeCompare(partners.rows[b.i].id));
    for(let i=0;i<remainder;i++)whole[ranking[i].i]++;
    const allocationId='allocation-'+randomUUID();
    await client.query(
      `INSERT INTO ars_partner_profit_allocations
       (id,shop_id,period_key,approved_profit_lkr,approval_reference,note,approved_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [allocationId,shopId,periodKey,approvedProfitLkr,approvalReference.trim(),note,approvedBy]);
    for(let i=0;i<partners.rows.length;i++){
      await client.query(
        `INSERT INTO ars_partner_profit_shares
         (allocation_id,partner_id,ownership_basis_points,allocated_lkr) VALUES($1,$2,$3,$4)`,
        [allocationId,partners.rows[i].id,basisPoints[i],whole[i]/100]);
    }
    await client.query('COMMIT');
    return {allocationId,periodKey,approvedProfitLkr,
      shares:partners.rows.map((p,i)=>({partnerId:p.id,name:p.name,
        ownershipPercent:basisPoints[i]/100,allocatedLkr:whole[i]/100}))};
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {client.release();}
};
