import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('both graphical review centers expose non-authorizing intent operations',()=>{
 const m=read('scripts/mint/update-center.py');
 const mint=m.slice(m.indexOf('def switch_intent_review'),m.indexOf('def activation_review'));
 assert.match(mint,/RETAIN MINT SWITCH INTENT/);
 assert.match(mint,/CANCEL MINT SWITCH INTENT/);
 assert.match(mint,/maintenanceRetained/);
 assert.doesNotMatch(mint,/systemctl|resume_maintenance/);
 const w=read('scripts/show-windows-activation-review.ps1');
 assert.match(w,/-Cancel -Confirmation 'CANCEL SWITCH INTENT'/);
 assert.match(w,/-Confirmation 'RETAIN SWITCH INTENT'/);
 assert.match(w,/maintenanceRetained/);
 assert.doesNotMatch(w,/Start-Process|Remove-Item/);
});
