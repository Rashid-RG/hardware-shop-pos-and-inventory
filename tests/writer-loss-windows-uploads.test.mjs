import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/writer-loss-windows-restore.mjs',import.meta.url),'utf8');
test('Windows uploads are checked inside disposable container without extracting paths',()=>{
 assert.match(source,/hash\.digest\('hex'\)!==expected/);
 assert.match(source,/sha256sum','\/tmp\/incident-uploads\.zip/);
 assert.match(source,/unzip -p \/tmp\/incident-uploads\.zip >\/dev\/null/);
 assert.match(source,/uploadArchiveChecked=true/);
 assert.match(source,/counts,uploadArchiveChecked/);
});
