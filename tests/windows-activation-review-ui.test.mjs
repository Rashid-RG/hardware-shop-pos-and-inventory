import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL('../scripts/'+n,import.meta.url),'utf8');
test('Windows graphical activation review only prepares or verifies a proposal',()=>{
 const s=read('show-windows-activation-review.ps1');
 assert.match(s,/Button2/);
 assert.match(s,/-Confirmation 'PREPARE RUNTIME ACTIVATION'/);
 assert.match(s,/-RecoveryId \$id -Verify/);
 assert.match(s,/proposalMatched/);
 assert.doesNotMatch(s,/Start-Process|Remove-Item|Move-Item|Set-ItemProperty/);
 assert.match(read('show-windows-recovery-center.ps1'),/show-windows-activation-review\.ps1/);
 assert.match(read('prepare-windows-runtime-activation.ps1'),/\$Confirmation -cne 'PREPARE RUNTIME ACTIVATION'/);
});
