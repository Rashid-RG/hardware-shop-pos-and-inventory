// Fixed disposable fixture; never loads server.ts or connects to PostgreSQL.
const mode=process.argv[2];
process.on('disconnect',()=>process.exit(1));
process.on('message',msg=>{
 if(msg?.schema!==1)process.exit(1);
 if(msg.type==='challenge'){
  if(mode==='silent')return;
  const binding={...msg.binding,candidatePid:process.pid};
  if(mode==='wrong-binding')binding.purpose=binding.purpose==='candidate'?'rollback':'candidate';
  const proof={schema:1,type:'proof',token:msg.token,binding};
  process.send(proof);
  if(mode==='replay')process.send(proof);
 }else if(msg.type==='accepted'){
  if(mode==='replay')return;
  process.exit(0);
 }else process.exit(1);
});
