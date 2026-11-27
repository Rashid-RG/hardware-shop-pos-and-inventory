// Disposable Windows CI fixture. No live database or installed application access.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted')throw Error('Disposable Windows CI only.');
const [supervisor,dir]=process.argv.slice(2);
if(!supervisor||!dir)throw Error('Fixture paths required.');
async function run(mode){
 const marker=join(dir,mode+'.json');
 const source=mode==='success'
  ?"require('node:fs').writeFileSync(process.argv[1],'ok')"
  :"const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});const fs=require('node:fs');fs.writeFileSync(process.argv[1]+'.tmp',JSON.stringify([process.pid,c.pid]));fs.renameSync(process.argv[1]+'.tmp',process.argv[1]);setInterval(()=>{},1000)";
 const child=spawn(supervisor,[mode==='protocol'?'--invalid':'--private-worker-v1','15000',dir,process.execPath,'-e',source,marker],{cwd:dir,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
 let output=0;
 child.stdout.on('data',b=>{output+=b.length;});
 child.stderr.on('data',b=>{output+=b.length;});
 child.stdin.on('error',()=>{});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 done.catch(()=>{});
 const timer=setTimeout(()=>child.kill(),30000);
 try{
  if(mode==='missing')child.stdin.end();
  else if(mode==='invalid')child.stdin.end('X');
  else if(mode==='protocol')child.stdin.end();
  else child.stdin.write('A');
  if(mode==='eof'||mode==='revoke'){
   let ids;
   for(let i=0;i<200;i++){
    try{ids=JSON.parse(await readFile(marker,'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}
    await delay(50);
   }
   assert.equal(ids?.length,2,'worker readiness not observed');
   if(mode==='eof')child.stdin.end();else child.stdin.write('X');
   assert.deepEqual(await done,{code:75,signal:null});
   for(const pid of ids){
    assert.ok(Number.isSafeInteger(pid)&&pid>1);
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
   }
  }else{
   assert.deepEqual(await done,{code:mode==='success'?0:mode==='protocol'?64:70,signal:null});
   if(mode==='success')assert.equal(await readFile(marker,'utf8'),'ok');
   else await assert.rejects(access(marker),{code:'ENOENT'});
  }
  assert.equal(output,0,'supervisor must not disclose diagnostics');
 }finally{
  clearTimeout(timer);
  child.stdin.destroy();
  if(child.exitCode===null&&child.signalCode===null){child.kill();await done.catch(()=>{});}
 }
}
for(const mode of ['protocol','missing','invalid','success','eof','revoke'])await run(mode);
console.log('Private Windows supervisor pipe regression checks passed.');
