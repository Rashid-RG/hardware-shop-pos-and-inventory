import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const bundled=await build({entryPoints:[fileURLToPath(new URL('../backend/recoveryPayrollControls.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {inspectRecoveryPayrollControls}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
test('offline payroll control inspection rejects wrong identity and reports empty coverage',async()=>{
 const expected={database:'hardware_pos_ci',systemIdentifier:'123',databaseOid:'456'};
 for(const mismatch of [true,false]){
 const calls=[];
 const c={query:async sql=>{calls.push(sql);if(sql.includes('pg_control_system()'))return {rows:[{database:expected.database,system_identifier:mismatch?'999':'123',database_oid:'456',read_only:true,snapshot:true}]};return {rows:[]};}};
 const r=await inspectRecoveryPayrollControls(c,expected);
 assert.equal(r.state,mismatch?'payroll-control-inspection-unavailable':'no-coverage');
 assert.equal(r.recoveryAllowed,false);assert.equal(calls.at(-1),'ROLLBACK');
 }
});
