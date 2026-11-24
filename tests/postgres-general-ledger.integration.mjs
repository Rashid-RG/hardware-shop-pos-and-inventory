import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {initGeneralLedger,validateJournal} from '../backend/generalLedger.ts';

const url=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
assert.equal(url.pathname,'/hardware_pos_ci','Refuse non-CI database');

test('journal arithmetic uses exact cents and rejects malformed entries',()=>{
 const d=(amount)=>({accountCode:'1000',debit:amount,credit:'0'});
 const c=(amount)=>({accountCode:'3000',debit:'0',credit:amount});
 assert.deepEqual(validateJournal([d('0.10'),d('0.20'),c('0.30')]),{totalCents:'30'});
 for(const lines of [[d('1'),c('0.99')],[d('1.001'),c('1.001')],[d('0'),c('0')],[d('-1'),c('-1')],[d('1')]]) assert.throws(()=>validateJournal(lines));
});

test('PostgreSQL journal constraints and transaction rollback', {timeout:60000},async()=>{
 const db=new pg.Client({connectionString:url.toString()});
 const suffix=randomUUID().replaceAll('-','');
 const schema='gl_ci_'+suffix;
 const shop='shop-a',other='shop-b';
 const day='2026-01-01';
 await db.connect();
 try{
  await db.query('CREATE SCHEMA '+schema);
  await db.query('SET search_path TO '+schema);
  await initGeneralLedger(db);
  await db.query("INSERT INTO ars_gl_accounts(shop_id,code,name,kind,active) VALUES ($1,'1000','Cash','Asset',true),($1,'3000','Capital','Equity',true),($1,'5000','Inactive','Expense',false),($2,'9999','Other shop','Asset',true)",[shop,other]);
  const header=(id,source=id,date=day)=>db.query("INSERT INTO ars_gl_journals(shop_id,id,posting_date,source_kind,source_id,description,recorded_by) VALUES ($1,$2,$3,'Test',$4,'CI fixture','CI')",[shop,id,date,source]);
  const line=(id,n,code,d,c)=>db.query("INSERT INTO ars_gl_lines(shop_id,journal_id,line_no,account_code,debit,credit) VALUES ($1,$2,$3,$4,$5,$6)",[shop,id,n,code,d,c]);
  const rejected=async(fn,code='23514')=>{
   await db.query('BEGIN');
   try{await assert.rejects(async()=>{await fn();await db.query('COMMIT');},e=>e.code===code);}
   finally{await db.query('ROLLBACK');}
  };
  await rejected(()=>header('disabled'));
  await db.query("INSERT INTO ars_gl_cutover(shop_id,cutover_date,evidence,approved_by,posting_enabled) VALUES ($1,$2,'CI sample','CI',true)",[shop,day]);
  await rejected(()=>header('before','before','2025-12-31'));
  await rejected(()=>header('empty'));
  await rejected(async()=>{await header('unbalanced');await line('unbalanced',1,'1000','10','0');await line('unbalanced',2,'3000','0','9');});
  await rejected(async()=>{await header('inactive');await line('inactive',1,'5000','10','0');});
  await rejected(async()=>{await header('cross-shop');await line('cross-shop',1,'9999','10','0');});
  assert.equal((await db.query('SELECT count(*)::int n FROM ars_gl_journals')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM ars_gl_lines')).rows[0].n,0);
  await db.query('BEGIN');
  await header('balanced');
  await line('balanced',1,'1000','10.10','0');
  await line('balanced',2,'3000','0','10.10');
  await db.query('COMMIT');
  await rejected(()=>header('duplicate','balanced'),'23505');
  await rejected(()=>line('balanced',3,'1000','1','0'));
  for(const sql of ["UPDATE ars_gl_lines SET debit=20 WHERE line_no=1","DELETE FROM ars_gl_lines","UPDATE ars_gl_journals SET description='Changed'","DELETE FROM ars_gl_journals"]) await rejected(()=>db.query(sql));
  assert.deepEqual((await db.query('SELECT count(*)::int n,sum(debit)::text debit,sum(credit)::text credit FROM ars_gl_lines')).rows[0],{n:2,debit:'10.10',credit:'10.10'});
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.query('SET search_path TO public');
  await db.query('DROP SCHEMA '+schema+' CASCADE');
  await db.end();
 }
});
