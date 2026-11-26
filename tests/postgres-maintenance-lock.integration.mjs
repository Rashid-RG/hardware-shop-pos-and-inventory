import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
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
