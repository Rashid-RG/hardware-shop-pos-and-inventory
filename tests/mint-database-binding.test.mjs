import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/mint/database-binding.py',import.meta.url),'utf8');
test('Mint registration compares container and host identities without replacing evidence',()=>{
 assert.match(s,/inside!=outside/);
 assert.match(s,/os\.O_EXCL/);
 assert.match(s,/\.ars-writer-loss\.json/);
 assert.match(s,/inspect\(\)!=first/);
 assert.match(s,/ars-mint_data/);
});
