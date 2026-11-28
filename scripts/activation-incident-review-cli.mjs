// Credentials arrive only over a private stdin pipe, never arguments or logs.
import {nativeAuthenticatedActivationReview} from './activation-incident-native-review.mjs';
const denied={state:'activation-review-blocked',activationAllowed:false,startupAllowed:false,recoveryAllowed:false,rollbackAllowed:false,runtimeActivated:false};
try{
 if(process.stdin.isTTY||process.argv.length!==2)throw Error('Private input required.');
 const chunks=[];let size=0;
 for await(const chunk of process.stdin){
  size+=chunk.length;
  if(size>8192)throw Error('Input limit exceeded.');
  chunks.push(chunk);
 }
 const raw=Buffer.concat(chunks);
 let input;
 try{input=JSON.parse(raw.toString('utf8'));}finally{raw.fill(0);for(const c of chunks)c.fill(0);}
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid request.');
 const result=await nativeAuthenticatedActivationReview({
  recoveryId:input.recoveryId,mode:input.mode,confirmation:input.confirmation,
  operator:input.operator,reviewer:input.reviewer
 });
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{
 process.stdout.write(JSON.stringify(denied)+'\n');
 process.exitCode=1;
}
