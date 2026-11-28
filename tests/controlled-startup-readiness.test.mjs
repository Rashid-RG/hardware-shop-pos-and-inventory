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

test('installed readiness refuses another release or process on the POS port',async()=>{
 const {createServer}=await import('node:http');
 const {verifyInstalledRelease}=await import('../scripts/verify-installed-release-readiness.mjs');
 const ready={ok:true,status:'ready',database:'reachable',sourceOfTruth:'normalized',buildVersion:'1.2.3',processId:4123};
 const server=createServer((_req,res)=>res.end(JSON.stringify(ready)));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const {port}=server.address();
  await verifyInstalledRelease('1.2.3',4123,port);
  await assert.rejects(verifyInstalledRelease('1.2.4',4123,port),/does not match/);
  await assert.rejects(verifyInstalledRelease('1.2.3',4124,port),/does not match/);
  ready.database='unreachable';
  await assert.rejects(verifyInstalledRelease('1.2.3',4123,port),/does not match/);
 }finally{
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 }
});


test('installed readiness bounds response size and rejects malformed or failed responses',async()=>{
 const {createServer}=await import('node:http');
 const {verifyInstalledRelease}=await import('../scripts/verify-installed-release-readiness.mjs');
 const ready={ok:true,status:'ready',database:'reachable',sourceOfTruth:'normalized',buildVersion:'1.2.3',processId:4123};
 let mode='large';
 const server=createServer((_req,res)=>{
  if(mode==='large'){res.write(JSON.stringify({...ready,padding:'x'.repeat(17000)}));res.end();}
  else if(mode==='invalid')res.end('{invalid');
  else if(mode==='unready'){res.statusCode=503;res.end(JSON.stringify(ready));}
  else if(mode==='redirect'){res.statusCode=302;res.setHeader('Location','/elsewhere');res.end();}
  else res.end(JSON.stringify(ready));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const {port}=server.address();
  await assert.rejects(verifyInstalledRelease('1.2.3',4123,port),/exceeds limit/);
  mode='invalid';await assert.rejects(verifyInstalledRelease('1.2.3',4123,port),/Invalid POS readiness response/);
  mode='unready';await assert.rejects(verifyInstalledRelease('1.2.3',4123,port),/not ready/);
  mode='redirect';await assert.rejects(verifyInstalledRelease('1.2.3',4123,port));
  mode='valid';await verifyInstalledRelease('1.2.3',4123,port);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
