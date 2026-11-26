import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
test('lost writer lease requires reconciliation and blocks API except diagnostic endpoints',()=>{
 const section=source.slice(source.indexOf("client.on('error', (error) => {"),source.indexOf('const released = await client.query'));
 assert.match(section,/databaseWriteHealthy = false/);
 assert.match(section,/interruptedWriteRequiresReview = true/);
 assert.match(source,/interruptedWriteRequiresReview && req\.path !== '\/health' && req\.path !== '\/ready'/);
 assert.ok(source.indexOf("interruptedWriteRequiresReview && req.path")<source.indexOf("if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method))"));
});
test('writer release verifies unlock and destroys dedicated lease session',()=>{
 const section=source.slice(source.indexOf('const releaseSingleWriterLease'),source.indexOf('const LOGIN_ATTEMPT_LIMIT'));
 assert.match(section,/released !== true/);
 assert.match(section,/client\.release\(true\)/);
});
