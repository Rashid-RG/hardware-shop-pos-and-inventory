import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {rehearseProtectedRecovery} from '../scripts/writer-loss-protected-rehearsal.mjs';
import {inspectRecoveryDatabase} from '../scripts/writer-loss-database-inspection.mjs';
import {acquireRehearsalWriter} from '../scripts/database-handoff-writer-rehearsal.mjs';
import {assertGateOwner} from '../scripts/database-handoff-gate.mjs';
const url=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
assert.equal(url.pathname,'/hardware_pos_ci','Refuse non-CI database');
test('maintenance SHARE lock allows reads, blocks writes and releases on rollback', {timeout:30000},async()=>{
  const lock=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
  const other=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
  const name='maintenance_ci_'+randomUUID().replaceAll('-','');
  const table='public."'+name+'"';
  try{
    await lock.connect();await other.connect();
    await other.query('CREATE TABLE '+table+' (id integer PRIMARY KEY, amount integer NOT NULL)');
    await other.query('INSERT INTO '+table+' VALUES (1,200)');
    await other.query("SET lock_timeout='300ms'");
    await lock.query('BEGIN');
    await lock.query('LOCK TABLE '+table+' IN SHARE MODE NOWAIT');
    assert.equal((await other.query('SELECT amount FROM '+table)).rows[0].amount,200);
    for(const sql of ['INSERT INTO '+table+' VALUES (2,50)','UPDATE '+table+' SET amount=0','DELETE FROM '+table,'ALTER TABLE '+table+' ADD COLUMN note text']){
      await assert.rejects(other.query(sql),err=>err.code==='55P03');
    }
    await lock.query('ROLLBACK');
    await other.query('UPDATE '+table+' SET amount=150 WHERE id=1');
    assert.equal((await other.query('SELECT amount FROM '+table)).rows[0].amount,150);
    // A pre-existing writer must cause immediate failure to acquire maintenance fence.
    await other.query('BEGIN');
    await other.query('UPDATE '+table+' SET amount=100');
    await lock.query('BEGIN');
    await assert.rejects(lock.query('LOCK TABLE '+table+' IN SHARE MODE NOWAIT'),err=>err.code==='55P03');
    await lock.query('ROLLBACK');
    await other.query('ROLLBACK');
    assert.equal((await other.query('SELECT amount FROM '+table)).rows[0].amount,150);
    // Closing the locking connection also releases transaction locks.
    await lock.query('BEGIN');
    await lock.query('LOCK TABLE '+table+' IN SHARE MODE NOWAIT');
    await lock.end();
    await other.query('UPDATE '+table+' SET amount=125');
    assert.equal((await other.query('SELECT amount FROM '+table)).rows[0].amount,125);
  }finally{
    await lock.end().catch(()=>{});
    await other.query('ROLLBACK').catch(()=>{});
    await other.query('DROP TABLE IF EXISTS '+table).catch(()=>{});
    await other.end().catch(()=>{});
  }
});

test('maintenance writer lease excludes application startup until connection ends',{timeout:30000},async()=>{
 const owner=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
 const candidate=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
 // A disposable random key isolates this test from parallel application CI.
 const key=[1642958133,Math.floor(Math.random()*2000000000)+2];
 const acquire=client=>client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',key);
 try{
  await owner.connect();await candidate.connect();
  assert.equal((await acquire(owner)).rows[0].acquired,true);
  assert.equal((await acquire(candidate)).rows[0].acquired,false);
  await owner.query('BEGIN');
  await owner.query('ROLLBACK');
  assert.equal((await acquire(candidate)).rows[0].acquired,false);
  await owner.end();
  assert.equal((await acquire(candidate)).rows[0].acquired,true);
 }finally{
  await owner.end().catch(()=>{});
  await candidate.end().catch(()=>{});
 }
});

test('handoff gate remains held while writer lease changes owners',{timeout:30000},async()=>{
 const gate=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
 const old=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
 const next=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
 const rival=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
 const cls=1642958133;
 // Random disposable keys prevent interference with the real application lease.
 const key=Math.floor(Math.random()*900000000)*2+10;
 const acquire=(c,id)=>c.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[cls,id]);
 const release=(c,id)=>c.query('SELECT pg_advisory_unlock($1::integer,$2::integer) AS released',[cls,id]);
 try{
  for(const c of [gate,old,next,rival]) await c.connect();
  assert.equal((await acquire(old,key)).rows[0].acquired,true);
  assert.equal((await acquire(gate,key+1)).rows[0].acquired,true);
  assert.equal((await acquire(rival,key+1)).rows[0].acquired,false);
  assert.equal((await release(old,key)).rows[0].released,true);
  assert.equal((await acquire(rival,key+1)).rows[0].acquired,false);
  assert.equal((await acquire(next,key)).rows[0].acquired,true);
  assert.equal((await release(gate,key+1)).rows[0].released,true);
  assert.equal((await acquire(rival,key+1)).rows[0].acquired,true);
  assert.equal((await acquire(rival,key)).rows[0].acquired,false);
 }finally{for(const c of [gate,old,next,rival])await c.end().catch(()=>{});}
});

test('failed candidate handoff retains transition gate until previous writer reacquires lease',{timeout:30000},async()=>{
 const clients=Array.from({length:5},()=>new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000}));
 const [gate,old,candidate,rollback,rival]=clients;
 const key=Math.floor(Math.random()*900000000)*2+10;
 const acquire=async(c,id)=>(await c.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[1642958133,id])).rows[0].acquired;
 const release=async(c,id)=>(await c.query('SELECT pg_advisory_unlock($1::integer,$2::integer) AS released',[1642958133,id])).rows[0].released;
 try{
  for(const c of clients)await c.connect();
  assert.equal(await acquire(old,key),true);
  assert.equal(await acquire(gate,key+1),true);
  assert.equal(await release(old,key),true);
  assert.equal(await acquire(candidate,key),true);
  assert.equal(await acquire(rival,key+1),false);
  // Simulate failed replacement before readiness: its session closes.
  await candidate.end();
  assert.equal(await acquire(rival,key+1),false);
  assert.equal(await acquire(rollback,key),true);
  assert.equal(await acquire(rival,key+1),false);
  assert.equal(await release(gate,key+1),true);
  assert.equal(await acquire(rival,key+1),true);
  assert.equal(await acquire(rival,key),false);
 }finally{for(const c of clients)await c.end().catch(()=>{});}
});
test('coordinator connection loss releases gate; writer lease alone does not protect a vacant transition',{timeout:30000},async()=>{
 const gate=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
 const rival=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
 const key=Math.floor(Math.random()*900000000)*2+10;
 const acquire=async c=>(await c.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[1642958133,key])).rows[0].acquired;
 try{
  await gate.connect();await rival.connect();
  assert.equal(await acquire(gate),true);
  assert.equal(await acquire(rival),false);
  await gate.end();
  // Explicitly document the failure boundary: a durable maintenance marker
  // and authenticated startup authorization must survive coordinator loss.
  assert.equal(await acquire(rival),true);
 }finally{await gate.end().catch(()=>{});await rival.end().catch(()=>{});}
});

test('observer verifies exact coordinator session and rejects released or replaced gate',{timeout:30000},async()=>{
 const owner=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
 const observer=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
 const lockClass=1642958133,lockId=Math.floor(Math.random()*900000000)+10;
 const keys=[lockClass,lockId],options={lockClass,lockId};
 try{
  await owner.connect();await observer.connect();
  const identity=(await owner.query('SELECT pg_backend_pid() AS pid, backend_start::text AS started FROM pg_stat_activity WHERE pid=pg_backend_pid()')).rows[0];
  await assert.rejects(assertGateOwner(observer,identity,options),/ownership not verified/);
  assert.equal((await owner.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',keys)).rows[0].acquired,true);
  await assertGateOwner(observer,identity,options);
  await assert.rejects(assertGateOwner(observer,{...identity,started:'2000-01-01T00:00:00Z'},options),/ownership not verified/);
  await owner.end();
  // Acquire from another session before asserting the old identity no longer matches.
  assert.equal((await observer.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',keys)).rows[0].acquired,true);
  await assert.rejects(assertGateOwner(observer,identity,options),/ownership not verified/);
 }finally{await owner.end().catch(()=>{});await observer.end().catch(()=>{});}
});

test('protected candidate lease acquisition rejects competing writers and lost coordinator',{timeout:30000},async()=>{
 const clients=Array.from({length:4},()=>new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000}));
 const [coordinator,old,candidate,rival]=clients;
 const writerId=Math.floor(Math.random()*900000000)*2+10;
 const gateId=writerId+1,lockClass=1642958133;
 const keys={writerId,gateId,lockClass};
 const acquire=async(c,id)=>(await c.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[lockClass,id])).rows[0].acquired;
 try{
  for(const c of clients)await c.connect();
  const identity=(await coordinator.query('SELECT pg_backend_pid() AS pid, backend_start::text AS started FROM pg_stat_activity WHERE pid=pg_backend_pid()')).rows[0];
  await assert.rejects(acquireRehearsalWriter(candidate,identity,keys),/ownership not verified/);
  assert.equal(await acquire(coordinator,gateId),true);
  assert.equal(await acquire(old,writerId),true);
  await assert.rejects(acquireRehearsalWriter(candidate,identity,keys),/lease unavailable/);
  await old.end();
  assert.deepEqual(await acquireRehearsalWriter(candidate,identity,keys),{writerLeaseAcquired:true,liveStartupAllowed:false});
  assert.equal(await acquire(rival,gateId),false);
  assert.equal(await acquire(rival,writerId),false);
  await candidate.end();
  await coordinator.end();
  await assert.rejects(acquireRehearsalWriter(rival,identity,keys),/ownership not verified/);
 }finally{for(const c of clients)await c.end().catch(()=>{});}
});

test('read-only recovery inspection detects real competing database sessions',{timeout:30000},async()=>{
 const observer=new pg.Client({connectionString:url.toString(),options:'-c default_transaction_read_only=on',connectionTimeoutMillis:5000,query_timeout:5000});
 const rival=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
 try{
  await observer.connect();await rival.connect();
  const identity=(await observer.query("SELECT current_database() AS database, system_identifier::text AS \"systemIdentifier\", (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS \"databaseOid\" FROM pg_control_system()")).rows[0];
  const result=await inspectRecoveryDatabase(observer,identity);
  assert.equal(result.state,'activity-detected');
  assert.ok(result.otherSessions>=1);
  assert.equal(result.recoveryAllowed,false);
  assert.equal((await inspectRecoveryDatabase(observer,{...identity,databaseOid:'0'})).state,'identity-or-readonly-mismatch');
 }finally{await observer.end().catch(()=>{});await rival.end().catch(()=>{});}
});

test('protected recovery rehearsal releases both keys after success or competing writer',{timeout:30000},async()=>{
 const make=()=>new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
 const rival=make(),first=make(),second=make();
 const gateId=Math.floor(Math.random()*900000000)*2+10,writerId=gateId+1;
 const fenceId=writerId+1;
 const keys={gateId,writerId,fenceId};
 const acquire=async id=>(await rival.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[1642958133,id])).rows[0].acquired;
 const release=async id=>(await rival.query('SELECT pg_advisory_unlock($1::integer,$2::integer) AS released',[1642958133,id])).rows[0].released;
 try{
  await rival.connect();await first.connect();
  assert.equal(await acquire(writerId),true);
  await assert.rejects(rehearseProtectedRecovery(first,keys),/lock unavailable/);
  assert.equal(await acquire(gateId),true);
  assert.equal(await release(gateId),true);
  assert.equal(await release(writerId),true);
  await second.connect();
  const result=await rehearseProtectedRecovery(second,keys);
  assert.equal(result.state,'protected-rehearsal-observed');
  assert.equal(result.recoveryAllowed,false);
  assert.equal(await acquire(gateId),true);
  assert.equal(await acquire(writerId),true);
  assert.equal(await acquire(fenceId),true);
 }finally{for(const c of [rival,first,second])await c.end().catch(()=>{});}
});

test('transaction fence survives loss of writer and blocks replacement until rollback',{timeout:30000},async()=>{
 const clients=Array.from({length:3},()=>new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000}));
 const [writer,tx,replacement]=clients;
 const writerId=Math.floor(Math.random()*900000000)*2+10, fenceId=writerId+1;
 const key=id=>[1642958133,id];
 const exclusive=async(c,id)=>(await c.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',key(id))).rows[0].acquired;
 try{
  for(const c of clients)await c.connect();
  assert.equal(await exclusive(writer,writerId),true);
  await tx.query('BEGIN');
  assert.equal((await tx.query('SELECT pg_try_advisory_xact_lock_shared($1::integer,$2::integer) AS acquired',key(fenceId))).rows[0].acquired,true);
  await writer.end();
  assert.equal(await exclusive(replacement,writerId),true);
  assert.equal(await exclusive(replacement,fenceId),false);
  await tx.query('ROLLBACK');
  assert.equal(await exclusive(replacement,fenceId),true);
 }finally{for(const c of clients)await c.end().catch(()=>{});}
});

test('real pg pool checkout discards unfinished transaction and preserves query callbacks',{timeout:30000},async()=>{
 const {readFile}=await import('node:fs/promises');
 const {transformSync}=await import('esbuild');
 const source=await readFile(new URL('../backend/transactionFence.ts',import.meta.url),'utf8');
 const {installTransactionFence}=await import('data:text/javascript;base64,'+Buffer.from(transformSync(source,{loader:'ts',format:'esm'}).code).toString('base64'));
 const pool=new pg.Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:5000});
 installTransactionFence(pool,async()=>{},async()=>{});
 try{
  const first=await pool.connect();
  const pid=(await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await first.query('BEGIN');
  first.release();
  const result=await pool.query('SELECT pg_backend_pid() AS pid');
  assert.notEqual(result.rows[0].pid,pid);
  const second=await pool.connect();
  await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal((await second.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
  assert.equal((await second.query('SHOW transaction_isolation')).rows[0].transaction_isolation,'repeatable read');
  await second.query('COMMIT');second.release();
  assert.equal((await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,result.rows[0].pid);
 }finally{await pool.end();}
});

test('standalone pool SQL is fenced and a rejected commit rolls back its write',{timeout:30000},async()=>{
 const {readFile}=await import('node:fs/promises');
 const {transformSync}=await import('esbuild');
 const source=await readFile(new URL('../backend/transactionFence.ts',import.meta.url),'utf8');
 const {installTransactionFence}=await import('data:text/javascript;base64,'+Buffer.from(transformSync(source,{loader:'ts',format:'esm'}).code).toString('base64'));
 const pool=new pg.Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:5000});
 let fail=false, admissions=0;
 installTransactionFence(pool,async()=>{if(fail)throw Error('simulated writer loss');},async()=>{admissions++;});
 try{
  await pool.query('CREATE TEMP TABLE ars_fence_fixture (n integer)');
  await pool.query('INSERT INTO ars_fence_fixture VALUES ($1)',[1]);
  fail=true;
  await assert.rejects(pool.query('INSERT INTO ars_fence_fixture VALUES ($1)',[2]),/simulated writer loss/);
  fail=false;
  const rows=await new Promise((resolve,reject)=>pool.query('SELECT n FROM ars_fence_fixture ORDER BY n',(error,result)=>error?reject(error):resolve(result.rows)));
  assert.deepEqual(rows,[{n:1}]);
  assert.equal(admissions,4);
  await assert.rejects(pool.query('BEGIN'),/Unsupported standalone/);
 }finally{await pool.end();}
});

test('maintenance fence excludes shared transaction locks until maintenance session closes',{timeout:30000},async()=>{
 const clients=Array.from({length:2},()=>new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000}));
 const [maintenance,tx]=clients;
 const keys=[1642958133,Math.floor(Math.random()*900000000)+10];
 try{
  for(const c of clients)await c.connect();
  assert.equal((await maintenance.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',keys)).rows[0].acquired,true);
  await tx.query('BEGIN');
  const shared=async()=> (await tx.query('SELECT pg_try_advisory_xact_lock_shared($1::integer,$2::integer) AS acquired',keys)).rows[0].acquired;
  assert.equal(await shared(),false);
  await maintenance.end();
  assert.equal(await shared(),true);
  await tx.query('ROLLBACK');
 }finally{for(const c of clients)await c.end().catch(()=>{});}
});

test('protected recovery rejects an outstanding shared transaction fence',{timeout:30000},async()=>{
 const make=()=>new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
 const tx=make(),recovery=make(),observer=make();
 const gateId=Math.floor(Math.random()*700000000)*3+10,writerId=gateId+1,fenceId=gateId+2;
 try{
  await tx.connect();await recovery.connect();await observer.connect();
  await tx.query('BEGIN');
  assert.equal((await tx.query('SELECT pg_try_advisory_xact_lock_shared($1::integer,$2::integer) AS acquired',[1642958133,fenceId])).rows[0].acquired,true);
  await assert.rejects(rehearseProtectedRecovery(recovery,{gateId,writerId,fenceId}),/Recovery lock unavailable/);
  for(const id of [gateId,writerId])assert.equal((await observer.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[1642958133,id])).rows[0].acquired,true);
  await tx.query('ROLLBACK');
  assert.equal((await observer.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[1642958133,fenceId])).rows[0].acquired,true);
 }finally{for(const c of [tx,recovery,observer])await c.end().catch(()=>{});}
});

test('recovery structural checks report real exceptions using disposable temporary tables',{timeout:30000},async()=>{
 const {inspectRecoveryBusinessRecords}=await import('../scripts/writer-loss-business-reconciliation.mjs');
 const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:15000});
 try{
  await client.connect();
  const expected=(await client.query("SELECT current_database() AS database,system_identifier::text AS \"systemIdentifier\",(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS \"databaseOid\" FROM pg_control_system()")).rows[0];
  await client.query("CREATE TEMP TABLE sales_transactions(id text,shop_id text,status text,subtotal numeric,tax numeric,discount_amount numeric,total numeric,customer_id text); CREATE TEMP TABLE sales_transaction_items(transaction_id text,quantity int,selling_price numeric,discount_amount numeric); CREATE TEMP TABLE customers(id text,shop_id text); CREATE TEMP TABLE suppliers(id text,shop_id text); CREATE TEMP TABLE customer_credit_payments(amount numeric,customer_id text,shop_id text,invoice_id text); CREATE TEMP TABLE supplier_payments(amount numeric,supplier_id text,shop_id text,purchase_order_id text); CREATE TEMP TABLE purchase_orders(id text,shop_id text,supplier_id text); CREATE TEMP TABLE products(id text,shop_id text,quantity int); CREATE TEMP TABLE stock_logs(product_id text,shop_id text); CREATE TEMP TABLE ars_gl_journals(shop_id text,id text); CREATE TEMP TABLE ars_gl_lines(shop_id text,journal_id text,line_no int,debit numeric,credit numeric,account_code text); CREATE TEMP TABLE ars_gl_accounts(shop_id text,code text)");
  assert.equal((await inspectRecoveryBusinessRecords(client,expected)).state,'structural-checks-matched');
  await client.query("INSERT INTO products VALUES ('p','s',-1); INSERT INTO ars_gl_journals VALUES ('s','j'); INSERT INTO sales_transactions VALUES ('i','s','Completed',10,0,0,10,'c')");
  const result=await inspectRecoveryBusinessRecords(client,expected);
  assert.equal(result.state,'exceptions-detected');
  assert.equal(result.checks.negativeProductStock,'1');
  assert.equal(result.checks.unbalancedJournals,'1');
  assert.equal(result.checks.emptyCompletedInvoices,'1');
  assert.equal(result.recoveryAllowed,false);
 }finally{await client.end();}
});

test('financial recovery controls compare exact signed balances on disposable temporary tables',{timeout:30000},async()=>{
 const {inspectRecoveryFinancialControls}=await import('../scripts/writer-loss-financial-reconciliation.mjs');
 const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:15000});
 try{
  await client.connect();
  const expected=(await client.query("SELECT current_database() AS database,system_identifier::text AS \"systemIdentifier\",(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS \"databaseOid\" FROM pg_control_system()")).rows[0];
  await client.query("CREATE TEMP TABLE customers(shop_id text,credit_balance numeric); CREATE TEMP TABLE ars_financial_accounts(shop_id text,id text,kind text); CREATE TEMP TABLE ars_financial_movements(shop_id text,account_id text,amount numeric); CREATE TEMP TABLE ars_gl_lines(shop_id text,account_code text,debit numeric,credit numeric); CREATE TEMP TABLE ars_gl_account_mappings(shop_id text,mapping_kind text,source_id text,account_code text); CREATE TEMP TABLE ars_gl_accounts(shop_id text,code text,kind text,active boolean); CREATE TEMP TABLE ars_gl_cutover(shop_id text,posting_enabled boolean)");
  await client.query("INSERT INTO customers VALUES ('s',100.25),('s',-10.50); INSERT INTO ars_financial_accounts VALUES ('s','bank','Bank'); INSERT INTO ars_financial_movements VALUES ('s','bank',25.10); INSERT INTO ars_gl_cutover VALUES ('s',true); INSERT INTO ars_gl_accounts VALUES ('s','1000','Asset',true),('s','2000','Liability',true),('s','1100','Asset',true); INSERT INTO ars_gl_account_mappings VALUES ('s','receivables','control','1000'),('s','customerCredits','control','2000'),('s','financialAccount','bank','1100'); INSERT INTO ars_gl_lines VALUES ('s','1000',100.25,0),('s','2000',0,10.50),('s','1100',25.10,0)");
  assert.equal((await inspectRecoveryFinancialControls(client,expected)).counts.matched,3);
  await client.query("UPDATE customers SET credit_balance=101.25 WHERE credit_balance>0");
  const r=await inspectRecoveryFinancialControls(client,expected);
  assert.equal(r.state,'control-review-required');assert.equal(r.counts.mismatch,1);assert.equal(r.recoveryAllowed,false);
  await client.query("UPDATE ars_gl_cutover SET posting_enabled=false");
  assert.equal((await inspectRecoveryFinancialControls(client,expected)).counts['posting-disabled'],3);
 }finally{await client.end();}
});

test('supplier and stock estimates distinguish incomplete coverage on temporary tables',{timeout:30000},async()=>{
 const {inspectRecoveryStockPayables}=await import('../scripts/writer-loss-stock-payables.mjs');
 const c=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:15000});
 try{
 await c.connect();
 const expected=(await c.query("SELECT current_database() AS database,system_identifier::text AS \"systemIdentifier\",(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS \"databaseOid\" FROM pg_control_system()")).rows[0];
 await c.query("CREATE TEMP TABLE products(shop_id text,quantity int,cost_price numeric,variants_json jsonb); CREATE TEMP TABLE purchase_orders(shop_id text,id text,supplier_id text,total numeric,status text); CREATE TEMP TABLE supplier_payments(shop_id text,supplier_id text,purchase_order_id text,amount numeric); CREATE TEMP TABLE ars_gl_cutover(shop_id text,posting_enabled boolean); CREATE TEMP TABLE ars_gl_accounts(shop_id text,code text,kind text,active boolean); CREATE TEMP TABLE ars_gl_account_mappings(shop_id text,mapping_kind text,source_id text,account_code text); CREATE TEMP TABLE ars_gl_lines(shop_id text,account_code text,debit numeric,credit numeric)");
 await c.query("INSERT INTO products VALUES ('s',10,5.25,'[]'); INSERT INTO purchase_orders VALUES ('s','p','supplier',100,'Received'); INSERT INTO supplier_payments VALUES ('s','supplier','p',25); INSERT INTO ars_gl_cutover VALUES ('s',true); INSERT INTO ars_gl_accounts VALUES ('s','1000','Asset',true),('s','2000','Liability',true); INSERT INTO ars_gl_account_mappings VALUES ('s','inventory','control','1000'),('s','supplierPayables','control','2000'); INSERT INTO ars_gl_lines VALUES ('s','1000',52.50,0),('s','2000',0,75)");
 assert.equal((await inspectRecoveryStockPayables(c,expected)).counts['estimate-matches'],2);
 await c.query("INSERT INTO products VALUES ('s',2,10,'[{\"id\":\"v\"}]'); INSERT INTO purchase_orders VALUES ('s','partial','supplier',20,'Partially Received')");
 const r=await inspectRecoveryStockPayables(c,expected);
 assert.equal(r.counts['incomplete-estimate'],2);
 assert.equal(r.recoveryAllowed,false);
 }finally{await c.end();}
});

test('partner controls compare contributions and drawings separately on disposable temporary tables',{timeout:30000},async()=>{
 const {inspectRecoveryPartnerControls}=await import('../scripts/writer-loss-partner-controls.mjs');
 const c=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:15000});
 try{
 await c.connect();
 const expected=(await c.query("SELECT current_database() AS database,system_identifier::text AS \"systemIdentifier\",(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS \"databaseOid\" FROM pg_control_system()")).rows[0];
 await c.query("CREATE TEMP TABLE ars_business_partners(shop_id text,id text); CREATE TEMP TABLE ars_partner_capital_entries(shop_id text,id text,partner_id text,entry_type text,amount_lkr numeric,entry_date date,created_by text); CREATE TEMP TABLE ars_gl_journals(shop_id text,id text,source_kind text,source_id text,posting_date date,recorded_by text); CREATE TEMP TABLE ars_gl_cutover(shop_id text,posting_enabled boolean); CREATE TEMP TABLE ars_gl_accounts(shop_id text,code text,kind text,active boolean); CREATE TEMP TABLE ars_gl_account_mappings(shop_id text,mapping_kind text,source_id text,account_code text); CREATE TEMP TABLE ars_gl_lines(shop_id text,account_code text,debit numeric,credit numeric)");
 await c.query("INSERT INTO ars_business_partners VALUES ('s','p'); INSERT INTO ars_partner_capital_entries VALUES ('s','a','p','Contribution',100.25,'2026-01-01','u'),('s','b','p','Drawing',20.10,'2026-01-02','u'); INSERT INTO ars_gl_journals VALUES ('s','j1','PartnerCapital','a','2026-01-01','u'),('s','j2','PartnerCapital','b','2026-01-02','u'); INSERT INTO ars_gl_cutover VALUES ('s',true); INSERT INTO ars_gl_accounts VALUES ('s','3000','Equity',true),('s','3001','Equity',true); INSERT INTO ars_gl_account_mappings VALUES ('s','partnerCapital','p','3000'),('s','partnerDrawings','p','3001'); INSERT INTO ars_gl_lines VALUES ('s','3000',0,100.25),('s','3001',20.10,0)");
 assert.equal((await inspectRecoveryPartnerControls(c,expected)).counts['selected-balance-matches'],2);
 await c.query("UPDATE ars_gl_lines SET debit=21.10 WHERE account_code='3001'");
 assert.equal((await inspectRecoveryPartnerControls(c,expected)).counts['balance-difference'],1);
 await c.query("INSERT INTO ars_gl_journals VALUES ('s','r','Reversal','j1','2026-01-03','u')");
 const r=await inspectRecoveryPartnerControls(c,expected);
 assert.equal(r.counts['entry-review'],1);assert.equal(r.recoveryAllowed,false);
 }finally{await c.end();}
});

test('import controls compare recognized liabilities less settlements on disposable tables',{timeout:30000},async()=>{
 const {inspectRecoveryImportControls}=await import('../scripts/writer-loss-import-controls.mjs');
 const c=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:15000});
 try{
 await c.connect();
 const expected=(await c.query("SELECT current_database() AS database,system_identifier::text AS \"systemIdentifier\",(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS \"databaseOid\" FROM pg_control_system()")).rows[0];
 await c.query("CREATE TEMP TABLE ars_gl_import_obligations(shop_id text,id text,amount numeric); CREATE TEMP TABLE ars_gl_import_obligation_reviews(shop_id text,obligation_id text,decision text); CREATE TEMP TABLE ars_gl_import_receipt_allocations(shop_id text,obligation_id text,amount numeric,journal_id text,batch_id text); CREATE TEMP TABLE ars_gl_import_settlements(shop_id text,id text,obligation_id text,amount numeric,journal_id text,payment_date date,recorded_by text,account_id text); CREATE TEMP TABLE ars_gl_journals(shop_id text,id text,source_kind text,source_id text,posting_date date,recorded_by text); CREATE TEMP TABLE ars_financial_movements(shop_id text,movement_kind text,source_id text,account_id text,amount numeric,effective_date date,recorded_by text); CREATE TEMP TABLE ars_gl_cutover(shop_id text,posting_enabled boolean); CREATE TEMP TABLE ars_gl_accounts(shop_id text,code text,kind text,active boolean); CREATE TEMP TABLE ars_gl_account_mappings(shop_id text,mapping_kind text,source_id text,account_code text); CREATE TEMP TABLE ars_gl_lines(shop_id text,account_code text,debit numeric,credit numeric)");
 await c.query("INSERT INTO ars_gl_import_obligations VALUES ('s','o',100); INSERT INTO ars_gl_import_obligation_reviews VALUES ('s','o','Approved'); INSERT INTO ars_gl_import_receipt_allocations VALUES ('s','o',80,'j1','b'); INSERT INTO ars_gl_import_settlements VALUES ('s','p','o',30,'j2','2026-01-02','u','bank'); INSERT INTO ars_gl_journals VALUES ('s','j1','ReceiptBatch','b','2026-01-01','u'),('s','j2','ImportCreditorPayment','p','2026-01-02','u'); INSERT INTO ars_financial_movements VALUES ('s','Import Creditor Payment','p','bank',-30,'2026-01-02','u'); INSERT INTO ars_gl_cutover VALUES ('s',true); INSERT INTO ars_gl_accounts VALUES ('s','2000','Liability',true); INSERT INTO ars_gl_account_mappings VALUES ('s','importPayables','control','2000'); INSERT INTO ars_gl_lines VALUES ('s','2000',30,80)");
 assert.equal((await inspectRecoveryImportControls(c,expected)).counts['selected-balances-match'],1);
 await c.query("UPDATE ars_gl_lines SET credit=81");
 assert.equal((await inspectRecoveryImportControls(c,expected)).counts['balance-difference'],1);
 await c.query("UPDATE ars_financial_movements SET amount=-31");
 const r=await inspectRecoveryImportControls(c,expected);
 assert.equal(r.counts['evidence-review'],1);assert.equal(r.recoveryAllowed,false);
 }finally{await c.end();}
});

test('fenced writer transfer and rollback retain the disposable coordinator gate',{timeout:30000},async()=>{
 const {rehearseFencedTransfer}=await import('../scripts/database-fenced-transfer-rehearsal.mjs');
 for(const failCandidate of [false,true]){
  const clients=Array.from({length:4},()=>new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000}));
  const base=100+Math.floor(Math.random()*1000000000);
  try{
   for(const c of clients)await c.connect();
   const r=await rehearseFencedTransfer(...clients,{gateId:base,writerId:base+1,fenceId:base+2,failCandidate,binding:{releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64)}});
   assert.equal(r.state,failCandidate?'rollback-rehearsed':'candidate-rehearsed');
   assert.equal(r.writerAndFenceVerified,true);assert.equal(r.privateFixtureAuthorizationVerified,true);assert.equal(r.fixtureIsDatabaseWriter,false);assert.equal(r.liveStartupAllowed,false);
   const probe=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000});
   try{
    await probe.connect();
    for(const id of [base,base+1,base+2])assert.equal((await probe.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[1642958133,id])).rows[0].acquired,true);
   }finally{await probe.end();}
  }finally{for(const c of clients)await c.end().catch(()=>{});}
 }
});

test('private authorized child owns disposable writer and fence itself',{timeout:30000},async()=>{
 const {rehearseChildWriter}=await import('../scripts/database-handoff-child-writer.mjs');
 const c=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
 const base=100+Math.floor(Math.random()*1000000000),keys={gateId:base,writerId:base+1,fenceId:base+2};
 try{
  await c.connect();
  assert.equal((await c.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[1642958133,base])).rows[0].acquired,true);
  for(const purpose of ['candidate','rollback']){
   const result=await rehearseChildWriter(c,url.toString(),keys,{releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64),purpose});
   assert.equal(result.childHeldWriterAndFence,true);assert.equal(result.liveStartupAllowed,false);
  }
 }finally{await c.end();}
});


test('combined activation transfer retains gate across candidate and rollback child processes',{timeout:60000},async()=>{
 const {rehearseActivationTransfer}=await import('../scripts/database-activation-transfer-rehearsal.mjs');
 const binding={releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64)};
 const result=await rehearseActivationTransfer(url.toString(),binding);
 assert.deepEqual(result,{
  candidateWriterRehearsed:true,rollbackWriterRehearsed:true,
  gateObservedAcrossTransitions:true,liveStartupAllowed:false,
  activationAllowed:false,continuousExclusionVerified:false
 });
});

test('rollback acquires PostgreSQL writer protection after candidate dies holding both leases',{timeout:60000},async()=>{
 const {rehearseActivationTransfer}=await import('../scripts/database-activation-transfer-rehearsal.mjs');
 const binding={releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64)};
 const result=await rehearseActivationTransfer(url.toString(),binding,{failCandidate:true});
 assert.equal(result.candidateFailureObserved,true);
 assert.equal(result.rollbackWriterRehearsed,true);
 assert.equal(result.gateObservedAcrossTransitions,true);
 assert.equal(result.liveStartupAllowed,false);
});

for(const failure of ['database-session-loss','ipc-disconnect','forced-child-exit']){
test('disposable child releases leases after '+failure,{timeout:60000},async()=>{
 const {fork}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const {randomInt}=await import('node:crypto');
 const {HANDOFF_CLASS}=await import('../scripts/database-handoff-gate.mjs');
 const c=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
 const probe=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
 const base=randomInt(10,2147483644),keys={gateId:base,writerId:base+1,fenceId:base+2};
 let child,closed,timer;
 const lock=async(client,id)=>(await client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[HANDOFF_CLASS,id])).rows[0].acquired;
 try{
  await c.connect();await probe.connect();
  assert.equal(await lock(c,keys.gateId),true);
  const owner=(await c.query("SELECT current_database() AS database,pg_backend_pid() AS pid,backend_start::text AS started,system_identifier::text AS cluster,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid FROM pg_stat_activity,pg_control_system() WHERE pid=pg_backend_pid()")).rows[0];
  child=fork(fileURLToPath(new URL('../scripts/database-handoff-writer-child.mjs',import.meta.url)),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??''}});
  // Observe process exit, not IPC stream closure: disconnect can leave close pending.
  closed=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  child.on('error',()=>{});
  const binding={releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64),purpose:'candidate',candidatePid:child.pid};
  const {createHandoffAuthorization}=await import('../scripts/database-handoff-authorization.mjs');
  const grant=createHandoffAuthorization(binding,{ttlMs:10000});
  try{
   await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('Coordinator loss fixture did not acquire leases.')),12000);
    child.once('error',reject);
    child.once('exit',()=>reject(Error('Child exited before coordinator loss.')));
    let phase='proof';
    const send=m=>child.send(m,e=>{if(e)reject(e);});
    child.on('message',async m=>{
     try{
      assert.equal(m.schema,1);
      if(phase==='proof'){
       assert.equal(m.type,'proof');assert.equal(grant.consume(m.token,m.binding),true);
       phase='holding';send({schema:1,type:'accepted',connection:url.toString(),keys,owner});
      }else{
       assert.equal(phase,'holding');assert.equal(m.type,'holding');phase='verified';
       for(const id of [keys.writerId,keys.fenceId])await assertGateOwner(probe,m.owner,{lockClass:HANDOFF_CLASS,lockId:id});
       resolve();
      }
     }catch(e){reject(e);}
    });
    send({schema:1,type:'challenge',token:grant.token,binding});
   });
  }finally{clearTimeout(timer);grant.revoke();}
  assert.equal(child.connected,true);
  if(failure==='database-session-loss'){
   await c.end();
   // Keep IPC open: only the database gate has disappeared.
   assert.equal(child.connected,true);
  }else if(failure==='ipc-disconnect'){
   // Parent channel loss must stop the child even with the gate still held.
   child.disconnect();
  }else{
   // Abrupt process death bypasses the watchdog and normal cleanup.
   assert.equal(child.kill('SIGKILL'),true);
  }
  const result=await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Watchdog did not stop the child.')),10000);})]);
  clearTimeout(timer);
  if(failure==='forced-child-exit')assert.deepEqual(result,{code:null,signal:'SIGKILL'});
  else assert.deepEqual(result,{code:1,signal:null});
  if(failure!=='database-session-loss'){
   await assertGateOwner(probe,owner,{lockClass:HANDOFF_CLASS,lockId:keys.gateId});
   assert.equal(await lock(probe,keys.gateId),false);
  }else assert.equal(await lock(probe,keys.gateId),true);
  // PostgreSQL may need a short interval to observe the dead socket.
  for(const id of [keys.writerId,keys.fenceId]){
   let acquired=false;
   for(let attempt=0;attempt<100&&!acquired;attempt++){
    acquired=await lock(probe,id);
    if(!acquired)await new Promise(resolve=>setTimeout(resolve,25));
   }
   assert.equal(acquired,true,'Child lease did not clear');
  }
  if(failure==='forced-child-exit'){
   // Release only the diagnostic leases; never release the coordinator gate.
   for(const id of [keys.writerId,keys.fenceId]){
    assert.equal((await probe.query('SELECT pg_advisory_unlock($1::integer,$2::integer) AS released',[HANDOFF_CLASS,id])).rows[0].released,true);
   }
   const {rehearseChildWriter}=await import('../scripts/database-handoff-child-writer.mjs');
   for(const purpose of ['rollback','candidate']){
    await assertGateOwner(probe,owner,{lockClass:HANDOFF_CLASS,lockId:keys.gateId});
    assert.equal(await lock(probe,keys.gateId),false);
    const recovered=await rehearseChildWriter(c,url.toString(),keys,{releaseDigest:binding.releaseDigest,runtimeDigest:binding.runtimeDigest,maintenanceDigest:binding.maintenanceDigest,purpose});
    assert.equal(recovered.childHeldWriterAndFence,true);
    assert.equal(recovered.authorizationVerified,true);
    assert.equal(recovered.liveStartupAllowed,false);
    await assertGateOwner(probe,owner,{lockClass:HANDOFF_CLASS,lockId:keys.gateId});
    assert.equal(await lock(probe,keys.gateId),false);
   }
   for(const id of [keys.writerId,keys.fenceId])assert.equal(await lock(probe,id),true);
  }
 }finally{
  clearTimeout(timer);
  try{
   if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
   if(closed){
    let cleanupTimer;
    try{await Promise.race([closed,new Promise((_,reject)=>{cleanupTimer=setTimeout(()=>reject(Error('Child cleanup timed out.')),5000);})]);}
    finally{clearTimeout(cleanupTimer);if(child.connected)child.disconnect();child.unref();}
   }
  }finally{await Promise.allSettled([c.end(),probe.end()]);}
 }
});
}

test('protected session reads the actual cluster identity for both installed database names',{timeout:30000},async()=>{
 const {withMaintenanceSession}=await import('../scripts/database-maintenance-session.mjs');
 const {withMaintenanceTableFence}=await import('../scripts/database-maintenance-table-fence.mjs');
 const {readProtectedMaintenanceClusterIdentity,assertMaintenanceClusterMatch}=await import('../scripts/maintenance-cluster-identity.mjs');
 const admin=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
 const identities=[];
 await admin.connect();
 try{
  const {rows:[cluster]}=await admin.query('SELECT system_identifier::text FROM pg_control_system()');
  for(const database of ['hardware_pos','hardware_pos_ars']){
   // A name collision fails before cleanup is registered. Only drop databases created here.
   await admin.query('CREATE DATABASE '+database);
   try{
    const databaseUrl=new URL(url);
    databaseUrl.pathname='/'+database;
    const connect=()=>new pg.Client({connectionString:databaseUrl.toString(),connectionTimeoutMillis:5000,query_timeout:5000});
    const setup=connect();
    await setup.connect();
    try{
     await setup.query('CREATE TABLE public.cluster_identity_fixture (id integer PRIMARY KEY)');
    }finally{
     await setup.end();
    }
    const client=connect();
    await withMaintenanceSession(client,database,session=>withMaintenanceTableFence(client,session,async scope=>{
     const identity=await readProtectedMaintenanceClusterIdentity(client,scope);
     assert.deepEqual(identity,{database,systemIdentifier:cluster.system_identifier,databaseOid:scope.owner.databaseOid});
     identities.push(identity);
    }));
   }finally{
    await admin.query('DROP DATABASE '+database);
   }
  }
  assert.notEqual(identities[0].databaseOid,identities[1].databaseOid);
  assert.throws(()=>assertMaintenanceClusterMatch(...identities),/PostgreSQL cluster identity mismatch/);
 }finally{
  await admin.end();
 }
});
