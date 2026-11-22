import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { initArsProfitLedger, recordArsProfitAllocation } from '../backend/partnerProfit.ts';

test('three-partner allocations reconcile to the cent and reject duplicates on isolated CI PostgreSQL', async()=>{
  const url=process.env.DATABASE_URL||'';
  assert.match(url,/^postgres(?:ql)?:\/\/[^\s]+@127\.0\.0\.1:5432\/hardware_pos_ci$/);
  const pool=new Pool({connectionString:url});
  const shop='profit-ci-'+randomUUID();
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ars_business_partners(
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, name TEXT NOT NULL,
      ownership_percent NUMERIC(5,2),created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await initArsProfitLedger(pool);
    const ids=[0,1,2].map(()=>'partner-'+randomUUID());
    for(let i=0;i<3;i++)await pool.query(
      `INSERT INTO ars_business_partners(id,shop_id,name,ownership_percent,created_by)
       VALUES($1,$2,$3,$4,'ci')`,[ids[i],shop,`Partner ${i+1}`,[33.33,33.33,33.34][i]]);
    const options={shopId:shop,periodKey:'2026-11',approvedProfitLkr:1.01,
      approvalReference:'CI-APPROVED-PROFIT',approvedBy:'CI user'};
    const allocation=await recordArsProfitAllocation(pool,options);
    assert.equal(allocation.shares.length,3);
    assert.equal(Math.round(allocation.shares.reduce((sum,row)=>sum+row.allocatedLkr,0)*100),101);
    const saved=await pool.query(
      `SELECT count(*)::integer AS count,round(sum(allocated_lkr),2) AS sum
       FROM ars_partner_profit_shares WHERE allocation_id=$1`,[allocation.allocationId]);
    assert.equal(saved.rows[0].count,3);
    assert.equal(Number(saved.rows[0].sum),1.01);
    await assert.rejects(recordArsProfitAllocation(pool,options),/already has a profit allocation/);
    const after=await pool.query('SELECT COUNT(*)::integer AS n FROM ars_partner_profit_allocations WHERE shop_id=$1',[shop]);
    assert.equal(after.rows[0].n,1);
    await pool.query('UPDATE ars_business_partners SET ownership_percent=30 WHERE id=$1',[ids[0]]);
    await assert.rejects(recordArsProfitAllocation(pool,{...options,periodKey:'2026-12'}),/total exactly 100%/);
    const aborted=await pool.query('SELECT COUNT(*)::integer AS n FROM ars_partner_profit_allocations WHERE shop_id=$1',[shop]);
    assert.equal(aborted.rows[0].n,1);
  } finally { await pool.end(); }
});
