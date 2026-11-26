import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
test('actual POS rechecks writer ownership and maintenance evidence before binding listener',()=>{
 const startup=source.slice(source.indexOf('async function startServer()'));
 const listener=startup.indexOf('app.listen(');
 const hydrate=startup.indexOf('await loadDb()');
 for(const check of ['await assertWriterBeforeCommit()','assertOrdinaryStartupAllowed()','assertNoWriterLoss(runtimePaths.root)']){
  assert.ok(startup.indexOf(check,hydrate)>hydrate&&startup.indexOf(check,hydrate)<listener,check);
 }
});
test('readiness requires a live writer before and after database probe',()=>{
 const start=source.indexOf("app.get('/api/ready'");
 const route=source.slice(start,source.indexOf('// One-time setup',start));
 assert.match(route,/interruptedWriteRequiresReview/);
 assert.match(route,/!singleWriterLease/);
 assert.match(route,/await assertWriterBeforeCommit\(\);\s*await pool.query\('SELECT 1'\);\s*await assertWriterBeforeCommit\(\);/);
 assert.match(route,/if \(shutdownRequested\).*503/);
});
