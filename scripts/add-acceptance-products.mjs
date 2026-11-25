// Run only against a disposable/test installation. No automatic startup seeding.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
const rl=createInterface({input:stdin,output:stdout});
const base='http://127.0.0.1:3000';
const rows=[
 ['Door Lock',12,650,900,'Locks'],['Padlock 40mm',24,300,450,'Locks'],['Padlock 60mm',12,500,750,'Locks'],
 ['Door Hinge 3 inch',50,80,120,'Fittings'],['Door Hinge 4 inch',50,110,160,'Fittings'],['Door Handle',20,350,500,'Fittings'],
 ['Tower Bolt 6 inch',24,150,220,'Fittings'],['Drawer Lock',24,180,270,'Locks'],['Cabinet Handle',50,100,150,'Fittings'],
 ['Measuring Tape 5m',12,300,450,'Tools'],['Screwdriver',24,160,240,'Tools'],['Combination Pliers',12,420,600,'Tools'],
 ['Adjustable Spanner',12,550,800,'Tools'],['Cutting Disc',50,90,140,'Tools'],['Drill Bit',100,60,100,'Tools'],
 ['PVC Ball Valve',24,200,300,'Plumbing'],['Water Tap',12,450,650,'Plumbing'],['Hose Clamp',100,35,60,'Plumbing'],
 ['Silicone Sealant',24,350,500,'Consumables'],['PTFE Thread Seal Tape',100,25,45,'Consumables']
];
let token='',shop='';
async function api(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(shop?{'X-Shop-Id':shop}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'HTTP '+response.status);return data;
}
try{
 console.log('ARS Distributors - Sample Product Setup | RS Nextward');
 const email=(await rl.question('Administrator email: ')).trim();
 if(!email||!stdin.isTTY||!stdout.isTTY)throw Error('Use an interactive local terminal.');
 // Keep the password out of terminal output, command history and files.
 const originalWrite=stdout.write;
 let password;
 stdout.write('Password (hidden): ');
 try {
   stdout.write=function(chunk,...args){return true;};
   password=await rl.question('');
 } finally {
   stdout.write=originalWrite;
   stdout.write('\n');
 }
 let session;
 try {session=await api('/api/auth/login','POST',{email,password});}
 finally {password=undefined;}
 if(!session.token||!['Super Admin','Store Manager'].includes(session.user?.role))throw Error('Administrator or Store Manager login required.');
 token=session.token;
 const state=await api('/api/db');shop=state._meta?.activeShopId;
 if(!shop||state._meta?.sourceOfTruth!=='normalized')throw Error('Local normalized database required.');
 console.log('Target branch:',shop,'Company:',state.settings?.storeName);
 if(await rl.question('Only sample/test data allowed. Type ADD 20 TEST PRODUCTS to continue: ')!=='ADD 20 TEST PRODUCTS')throw Error('Cancelled.');
 for(let j=0;j<rows.length;j++){
 const [name,factor,cost,price,category]=rows[j],sku='TEST-ARS-'+String(j+1).padStart(3,'0');
 const current=await api('/api/db');
 if(current._meta?.activeShopId!==shop)throw Error('Branch changed.');
 if(current.products.some(p=>p.sku===sku)){console.log('Skipped existing',sku);continue;}
 const product=await api('/api/products','POST',{name:'[TEST] '+name,sku,barcode:'99090000'+String(j+1).padStart(4,'0'),brand:'Test sample',category,description:'Acceptance test only',costPrice:cost,sellingPrice:price,quantity:0,reorderLevel:factor,variants:[]});
 const configuration={baseUnit:'Piece',units:[{id:'piece',label:'Piece',baseUnits:1,sellingPrice:price},{id:'box',label:'Box',baseUnits:factor,sellingPrice:Math.round(price*factor*0.95)}]};
 const path='/api/products/'+encodeURIComponent(product.id);
 await api(path+'/packaging-draft','PUT',{configuration});
 await api(path+'/packaging-activate','POST',{confirmed:true});
 const fresh=await api('/api/db'),saved=fresh.products.find(p=>p.id===product.id);
 if(!saved?.sharedStockUnits||saved.quantity!==0)throw Error('Packaging activation not confirmed; review '+sku);
 await api(path,'PUT',{...saved,quantity:factor*10,reason:'Acceptance test opening stock'});
 console.log('Created',sku,name,'with',factor*10,'pieces');
 }
 const final=await api('/api/db');
 const ready=rows.filter((_,i)=>final.products.some(p=>p.sku==='TEST-ARS-'+String(i+1).padStart(3,'0')&&p.sharedStockUnits&&p.quantity>0)).length;
 console.log('Ready sample products: '+ready+'/20. Review Products before testing.');
 if(ready!==20)process.exitCode=1;
}catch(error){console.error('Stopped:',error.message,'Previously committed items remain. Review them before retrying.');process.exitCode=1;}finally{rl.close();}
