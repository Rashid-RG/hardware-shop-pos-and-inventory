import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const b=await build({entryPoints:[fileURLToPath(new URL('../backend/recoveryInventoryValuation.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {recoveryProductValue}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const shared={baseUnit:'Piece',units:[{id:'piece',label:'Piece',baseUnits:1,sellingPrice:10},{id:'box',label:'Box',baseUnits:12,sellingPrice:100}]};
test('shared stock counted once at base cost and variants valued independently',()=>{
 assert.equal(recoveryProductValue({quantity:25,cost_price:'2.25',shared_stock_units:shared}),5625n);
 assert.equal(recoveryProductValue({quantity:5,cost_price:'999',variants_json:[{id:'a',quantity:2,costPrice:2.25},{id:'b',quantity:3,costPrice:3}]}),1350n);
});
test('invalid inventory breakdown fails closed',()=>{
 for(const p of [{quantity:1,cost_price:'0'},{quantity:5,variants_json:[{id:'a',quantity:2,costPrice:3}]},{quantity:2,shared_stock_units:shared,variants_json:[{id:'a',quantity:2,costPrice:3}]},{quantity:2,cost_price:'1',shared_stock_units:{...shared,units:[]}}])assert.throws(()=>recoveryProductValue(p));
});
