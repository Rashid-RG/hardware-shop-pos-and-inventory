import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const advance={id:'a1',employeeName:'Sample employee',journalId:'j1',issued:'50000.01',recovered:'25000.02',issues:[]};
const recovery={id:'r1',employeeName:'Sample employee',journalId:'j2',disbursementId:'a1',kind:'DirectRepayment',amount:'10000.01',issues:[]};
const fixture={advances:[advance],recoveries:[recovery,{...recovery,id:'r2',journalId:'j3',kind:'PayrollRecovery',amount:'15000.01'}],unattributed:[],mapping_count:1,ledger_balance:'24999.99',subledger_balance:'24999.99'};
const mock=row=>({query:async(sql,args)=>{assert.deepEqual(args,['shop-test']);assert.match(sql,/WHERE d\.shop_id=\$1/);assert.match(sql,/WHERE r\.shop_id=\$1/);return {rows:[row]};}});
test('employee advance reconciliation exact balances and exception safeguards',async t=>{
 const dir=await mkdtemp(join(process.cwd(),'.advance-reconciliation-test-'));
 try{
 const output=join(dir,'advance.mjs');
 await build({entryPoints:['backend/employeeAdvanceReconciliation.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'});
 const {reconcileEmployeeAdvances}=await import(pathToFileURL(output).href);
 const run=(changes={})=>reconcileEmployeeAdvances(mock({...fixture,...changes}),'shop-test');
 await t.test('partial recovery and matching control',async()=>{
 const r=await run();assert.equal(r.checksPassed,true);assert.equal(r.controlMatched,true);assert.equal(r.advances[0].outstanding,'24999.99');assert.equal(r.postingEnabled,false);
 });
 await t.test('different decimal display scales are equivalent',async()=>{
 const r=await run({advances:[],recoveries:[],ledger_balance:'0',subledger_balance:'0.00'});assert.equal(r.controlMatched,true);
 });
 await t.test('control mismatch and missing mapping fail closed',async()=>{
 assert.equal((await run({ledger_balance:'25000.00'})).checksPassed,false);
 assert.equal((await run({mapping_count:0})).controlMatched,false);
 assert.equal((await run({ledger_balance:'-1.00',subledger_balance:'-1.00'})).controlMatched,false);
 });
 await t.test('over-recovery does not expose a verified negative outstanding balance',async()=>{
 const r=await run({advances:[{...advance,recovered:'60000.00',issues:['ADVANCE_OVER_RECOVERY']}]});assert.equal(r.advances[0].outstanding,null);assert.equal(r.checksPassed,false);
 });
 await t.test('recovery movement and orphan records block passing result',async()=>{
 const r=await run({recoveries:[{...recovery,issues:['REPAYMENT_MOVEMENT']}],unattributed:[{id:'orphan',issue:'ORPHAN_ADVANCE_JOURNAL'}]});assert.equal(r.checksPassed,false);
 });
 await t.test('malformed monetary balance rejected',async()=>{
 await assert.rejects(run({ledger_balance:'NaN'}),/Invalid advance control balance/);
 });
 await t.test('invalid shop is rejected before querying',async()=>{
 await assert.rejects(reconcileEmployeeAdvances({query:async()=>{throw Error('must not query');}},''),/shop/);
 });
 }finally{await rm(dir,{recursive:true,force:true});}
});
