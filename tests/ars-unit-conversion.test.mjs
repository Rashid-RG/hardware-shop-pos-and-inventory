import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSharedStock, baseQuantity, availableSellingUnits, deductSharedStock, restoreSharedStock } from '../src/utils/unitConversion.ts';
const config={baseUnit:'Piece',units:[{id:'piece',label:'Piece',baseUnits:1,sellingPrice:500},{id:'box',label:'Box',baseUnits:12,sellingPrice:5400}]};
test('mixed packaging uses a single stock balance',()=>{
  validateSharedStock(config);
  assert.equal(deductSharedStock(120,[{quantity:2,baseUnits:12},{quantity:4,baseUnits:1}]),92);
  assert.equal(availableSellingUnits(92,12),7);
  assert.equal(restoreSharedStock(92,2,12),116);
  assert.equal(restoreSharedStock(116,4,1),120);
});
test('mixed lines cannot oversell independently',()=>{
  assert.throws(()=>deductSharedStock(12,[{quantity:1,baseUnits:12},{quantity:1,baseUnits:1}]),/Insufficient/);
});
test('reject invalid conversions and unsafe quantities',()=>{
  for(const factor of [0,-1,1.5,Infinity]) assert.throws(()=>baseQuantity(1,factor));
  assert.throws(()=>baseQuantity(Number.MAX_SAFE_INTEGER,2));
  assert.throws(()=>validateSharedStock({...config,units:[config.units[1]]}));
  assert.throws(()=>validateSharedStock({...config,units:[config.units[0],config.units[0]]}));
});
