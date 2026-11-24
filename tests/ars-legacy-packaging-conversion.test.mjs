import test from 'node:test';
import assert from 'node:assert/strict';
import { previewLegacyPackaging } from '../src/utils/legacyPackagingConversion.ts';
const config={baseUnit:'Piece',units:[{id:'piece',label:'Piece',baseUnits:1,sellingPrice:15},{id:'box',label:'Box',baseUnits:100,sellingPrice:1500}]};
const fixture={quantity:20,reorderLevel:5,costPrice:1000,sellingPrice:1500,legacyUnitId:'box',configuration:config};
test('conversion preserves stock value and scales reorder quantities',()=>{
 const result=previewLegacyPackaging(fixture);
 assert.equal(result.eligible,true);
 assert.equal(result.newQuantity,2000);
 assert.equal(result.newReorderLevel,500);
 assert.equal(result.newCostPrice,10);
 assert.equal(result.valueBefore,20000);
 assert.equal(result.valueAfter,20000);
 assert.equal(result.valuationDifference,0);
});
test('legacy unit must be selected explicitly and price or valuation differences block conversion',()=>{
 assert.throws(()=>previewLegacyPackaging({...fixture,legacyUnitId:''}),/Explicitly/);
 assert.equal(previewLegacyPackaging({...fixture,costPrice:1000.01}).eligible,false);
 assert.equal(previewLegacyPackaging({...fixture,sellingPrice:1600}).eligible,false);
});
test('zero stock is supported and invalid or overflowing quantities are rejected',()=>{
 assert.equal(previewLegacyPackaging({...fixture,quantity:0,reorderLevel:0}).newQuantity,0);
 assert.throws(()=>previewLegacyPackaging({...fixture,quantity:-1}));
 assert.throws(()=>previewLegacyPackaging({...fixture,quantity:1.5}));
 assert.throws(()=>previewLegacyPackaging({...fixture,quantity:2147483647}));
 assert.throws(()=>previewLegacyPackaging({...fixture,configuration:{...config,units:[config.units[0],{...config.units[1],baseUnits:0}]}}));
});
