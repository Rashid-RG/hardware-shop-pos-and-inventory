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
