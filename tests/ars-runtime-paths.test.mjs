import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRuntimePaths } from '../backend/runtimePaths.ts';

test('legacy runtime paths are unchanged',()=>{
 const root=path.resolve('example-release');
 const result=resolveRuntimePaths(root);
 assert.equal(result.external,false);
 assert.equal(result.config,path.join(root,'.env.local'));
 assert.equal(result.uploads,path.join(root,'uploads'));
});
test('explicit external runtime requires existing configuration, uploads and backups',()=>{
 const tmp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ars-runtime-')));
 try {
  const project=path.join(tmp,'release'), runtime=path.join(tmp,'runtime');
  fs.mkdirSync(project);fs.mkdirSync(runtime);
  assert.throws(()=>resolveRuntimePaths(project,'relative'));
  assert.throws(()=>resolveRuntimePaths(project,project));
  assert.throws(()=>resolveRuntimePaths(project,runtime));
  fs.writeFileSync(path.join(runtime,'.env.local'),'TEST_ONLY=true');
  fs.mkdirSync(path.join(runtime,'uploads'));fs.mkdirSync(path.join(runtime,'backups'));
  const result=resolveRuntimePaths(project,runtime);
  assert.equal(result.external,true);
  assert.equal(result.backups,path.join(runtime,'backups'));
  assert.equal(result.config,path.join(runtime,'.env.local'));
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
