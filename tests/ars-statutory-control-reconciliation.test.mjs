import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const epf={fund:'EPF',accountCode:'EPF-PAY',employee:'4800.01',employer:'7200.02',settled:'9000.00',ledgerBalance:'3000.03',subledgerBalance:'3000.03',difference:'0.00',exceptionCount:0,controlMatched:true};
const etf={fund:'ETF',accountCode:'ETF-PAY',employee:'0.00',employer:'1800.00',settled:'1200.00',ledgerBalance:'600.00',subledgerBalance:'600.00',difference:'0.00',exceptionCount:0,controlMatched:true};
const exception={id:'payroll-1',employeeName:'Sample Employee',period:'2026-11',fund:'EPF',journalId:'journal-1',issues:['CONTRIBUTION_COMPONENTS']};
const fixture={controls:[epf,etf],exceptions:[],unattributed:[]};
const mock=row=>({query:async(sql,args)=>{assert.deepEqual(args,['shop-test']);assert.match(sql,/WHERE a\.shop_id=\$1/);assert.match(sql,/WHERE l\.shop_id=\$1/);return {rows:[row]};}});

test('statutory control reconciliation response and posting safeguards',async t=>{
 const dir=await mkdtemp(join(process.cwd(),'.statutory-controls-test-'));
 try{
  const output=join(dir,'controls.mjs');
  await build({entryPoints:['backend/statutoryControlReconciliation.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'});
  const {reconcileStatutoryControls}=await import(pathToFileURL(output).href);
  const run=(changes={})=>reconcileStatutoryControls(mock({...fixture,...changes}),'shop-test');
  await t.test('matched funds retain exact recorded amounts',async()=>{
   const r=await run();assert.equal(r.checksPassed,true);assert.equal(r.postingEnabled,false);assert.deepEqual(r.controls,[epf,etf]);assert.equal(r.controls[0].subledgerBalance,'3000.03');
  });
  await t.test('ledger difference prevents passing result',async()=>{
   const r=await run({controls:[{...epf,ledgerBalance:'3000.04',difference:'0.01',controlMatched:false},etf]});
   assert.equal(r.checksPassed,false);assert.equal(r.controls[0].difference,'0.01');
  });
  await t.test('duplicate or missing contribution evidence blocks passing result',async()=>{
   const r=await run({controls:[{...epf,exceptionCount:1},etf],exceptions:[exception]});
   assert.equal(r.checksPassed,false);assert.deepEqual(r.exceptions[0].issues,['CONTRIBUTION_COMPONENTS']);
  });
  await t.test('settlement exceptions and reversals remain visible',async()=>{
   const r=await run({controls:[{...epf,exceptionCount:1},etf],exceptions:[{...exception,issues:['SETTLEMENT_AMOUNT_OR_EVIDENCE','ACCRUAL_JOURNAL']}]});
   assert.equal(r.checksPassed,false);assert.equal(r.exceptions[0].issues.length,2);
  });
  await t.test('orphan movement blocks passing result even when balances match',async()=>{
   const r=await run({unattributed:[{id:'orphan',issue:'ORPHAN_STATUTORY_MOVEMENT'}]});assert.equal(r.checksPassed,false);
  });
  await t.test('missing mapping, missing fund and negative liability are not matched',async()=>{
   assert.equal((await run({controls:[{...epf,accountCode:null,controlMatched:false},etf]})).checksPassed,false);
   assert.equal((await run({controls:[epf]})).checksPassed,false);
   assert.equal((await run({controls:[{...epf,ledgerBalance:'-1.00',subledgerBalance:'-1.00',controlMatched:false},etf]})).checksPassed,false);
  });
  await t.test('invalid shop and database errors propagate',async()=>{
   await assert.rejects(reconcileStatutoryControls({query:async()=>{throw Error('must not query');}},''),/shop/);
   await assert.rejects(reconcileStatutoryControls({query:async()=>{throw Error('database unavailable');}},'shop-test'),/database unavailable/);
  });
 }finally{await rm(dir,{recursive:true,force:true});}
});
