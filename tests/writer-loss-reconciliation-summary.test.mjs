import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyReconciliation} from '../scripts/writer-loss-reconciliation-summary.mjs';
test('reconciliation status distinguishes estimates, matches, absence and failure',()=>{
 assert.equal(classifyReconciliation('estimates-review-required','estimates-review-required'),'estimate-review');
 assert.equal(classifyReconciliation('no-coverage','selected-controls-matched'),'no-coverage');
 assert.equal(classifyReconciliation('selected-controls-matched','selected-controls-matched'),'selected-checks-match');
 assert.equal(classifyReconciliation('control-inspection-unavailable','selected-controls-matched'),'unavailable');
 assert.equal(classifyReconciliation('control-review-required','selected-controls-matched'),'review-required');
});
