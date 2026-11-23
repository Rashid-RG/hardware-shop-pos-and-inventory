import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { initArsProfitLedger, recordArsProfitAllocation, recordArsOwnershipAgreement } from '../backend/partnerProfit.ts';

test('dynamic partner allocations reconcile to the cent and reject duplicate accounting periods on isolated PostgreSQL', async()=>{
  const url=process.env.DATABASE_URL||'';
  assert.match(url,/^postgres(?:ql)?:\/\/[^\s]+@127\.0\.0\.1:5432\/hardware_pos_ci$/);
  const pool=new Pool({connectionString:url});
  const shop='profit-ci-'+randomUUID();
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ars_business_partners(
      id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, name TEXT NOT NULL,
      ownership_percent NUMERIC(5,2),is_active BOOLEAN NOT NULL DEFAULT TRUE,created_by TEXT NOT NULL,
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

    // New investors can join without reconfiguring or rewriting earlier allocations.
    const fourthId='partner-'+randomUUID();
    await pool.query(`INSERT INTO ars_business_partners(id,shop_id,name,ownership_percent,created_by)
      VALUES($1,$2,'Partner 4',10,'ci')`,[fourthId,shop]);
    for(let i=0;i<3;i++)await pool.query(
      'UPDATE ars_business_partners SET ownership_percent=$1 WHERE id=$2',
      [30,ids[i]]);
    const four=await recordArsProfitAllocation(pool,{...options,periodKey:'2026-12'});
    assert.equal(four.shares.length,4);
    assert.equal(four.shares.reduce((sum,share)=>Math.round(sum+share.allocatedLkr*100),0),101);
    const previous=await pool.query('SELECT COUNT(*)::integer AS n FROM ars_partner_profit_shares WHERE allocation_id=$1',
      [allocation.allocationId]);
    assert.equal(previous.rows[0].n,3,'Historical approval remains frozen at its original three partners');

    // An inactive partner is excluded from future splits, but preserved in prior approvals.
    await pool.query('UPDATE ars_business_partners SET ownership_percent=0,is_active=FALSE WHERE id=$1',[fourthId]);
    await pool.query('UPDATE ars_business_partners SET ownership_percent=40 WHERE id=$1',[ids[2]]);
    const rebalanced=await recordArsProfitAllocation(pool,{...options,periodKey:'2027-01'});
    assert.equal(rebalanced.shares.length,3);
    assert.equal(Math.round(rebalanced.shares.reduce((sum,share)=>sum+share.allocatedLkr,0)*100),101);
    const fourStill=await pool.query('SELECT COUNT(*)::integer AS n FROM ars_partner_profit_shares WHERE allocation_id=$1',
      [four.allocationId]);
    assert.equal(fourStill.rows[0].n,4);

    // New agreement applies only from its effective month; earlier approval rows are immutable.
    const agreement=await recordArsOwnershipAgreement(pool,{
      shopId:shop,effectivePeriod:'2027-02',approvalReference:'SIGNED-2027-02',
      approvedBy:'CI Super Admin',shares:[
        {partnerId:ids[0],ownershipPercent:20},
        {partnerId:ids[1],ownershipPercent:20},
        {partnerId:ids[2],ownershipPercent:60},
      ]
    });
    assert.equal(agreement.shares.length,3);
    const newPeriod=await recordArsProfitAllocation(pool,{...options,periodKey:'2027-02'});
    assert.deepEqual(newPeriod.shares.map(p=>p.ownershipPercent),[20,20,60]);
    await pool.query('UPDATE ars_business_partners SET ownership_percent=50 WHERE id=$1',[ids[0]]);
    const following=await recordArsProfitAllocation(pool,{...options,periodKey:'2027-03'});
    assert.deepEqual(following.shares.map(p=>p.ownershipPercent),[20,20,60],
      'Already approved agreement must override later direct ownership edits');
    await assert.rejects(recordArsOwnershipAgreement(pool,{
      shopId:shop,effectivePeriod:'2027-02',approvalReference:'LATE CHANGE',
      approvedBy:'CI Super Admin',shares:[
        {partnerId:ids[0],ownershipPercent:30},
        {partnerId:ids[1],ownershipPercent:30},
        {partnerId:ids[2],ownershipPercent:40},
      ]
    }),/after the latest approved profit allocation month/);
    const frozen=await pool.query(
      'SELECT ownership_basis_points FROM ars_partner_profit_shares WHERE allocation_id=$1 ORDER BY partner_id',
      [allocation.allocationId]);
    assert.deepEqual(frozen.rows.map(p=>Number(p.ownership_basis_points)),[3333,3333,3334]);
  } finally { await pool.end(); }
});
