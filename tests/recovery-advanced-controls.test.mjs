import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
test('advanced recovery production entry bundles both inspectors',async()=>{
 const result=await build({entryPoints:[fileURLToPath(new URL('../backend/recoveryAdvancedControls.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
 const m=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 for(const fn of [m.inspectRecoveryPayrollControls,m.inspectRecoveryInventory]){
  assert.equal(typeof fn,'function');
  const r=await fn({},{});
  assert.equal(r.startupAllowed,false);assert.equal(r.recoveryAllowed,false);
 }
});
