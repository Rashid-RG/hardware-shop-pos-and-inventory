import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../scripts/mint/'+p,import.meta.url),'utf8');
test('Mint recovery shortcut is independent and never replaces existing launchers',()=>{
 const s=read('install-recovery-shortcut.py');
 assert.match(s,/os\.O_EXCL/);
 assert.match(s,/Terminal=false/);
 assert.match(s,/ars-recovery-center\.desktop/);
 assert.doesNotMatch(s,/systemctl|docker compose|\.unlink\(/);
 assert.match(read('install.sh'),/install-recovery-shortcut\.py/);
 assert.match(read('update-center.py'),/"Open Recovery Center":"recovery-center\.py"/);
});
