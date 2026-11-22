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
    CREATE TABLE IF NOT EXISTS ars_partner_profit_shares(
      allocation_id TEXT NOT NULL REFERENCES ars_partner_profit_allocations(id),
      partner_id TEXT NOT NULL REFERENCES ars_business_partners(id),
      ownership_basis_points INTEGER NOT NULL CHECK(ownership_basis_points>=0 AND ownership_basis_points<=10000),
      allocated_lkr NUMERIC(16,2) NOT NULL CHECK(allocated_lkr>=0),
      PRIMARY KEY(allocation_id,partner_id)
    );
  `);
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
    const partners=await client.query(
      'SELECT id,name,ownership_percent FROM ars_business_partners WHERE shop_id=$1 ORDER BY id FOR UPDATE',[shopId]);
    if(partners.rowCount!==3)throw new Error('Exactly three registered partners are required.');
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
