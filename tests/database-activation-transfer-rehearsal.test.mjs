import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearseActivationTransfer} from '../scripts/database-activation-transfer-rehearsal.mjs';
test('activation transfer rejects non-disposable database',async()=>{
 await assert.rejects(rehearseActivationTransfer('postgres://localhost/hardware_pos',{}),/Disposable/);
});
test('activation transfer rejects missing fixture binding',async()=>{
 await assert.rejects(rehearseActivationTransfer('postgres://localhost/hardware_pos_ci',{}),/binding/);
});
