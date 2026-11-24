import PDFDocument from 'pdfkit';
import type { BusinessReport } from './businessReport';

export function renderBusinessReportPdf(report:BusinessReport, brand:{name:string;address:string;phone:string}, logo:Buffer|null):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',layout:'landscape',margin:0,bufferPages:true,info:{Title:report.title,Author:brand.name,Creator:'RS Nextward'}});
  const chunks:Buffer[]=[];
  doc.on('data',(b:Buffer)=>chunks.push(b));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  try {
   const left=32,right=doc.page.width-32,width=right-left,bottom=doc.page.height-48;
   const navy='#152945',gold='#D6A62C',ink='#24364D';
   const text=(s:string,x:number,y:number,w:number,size=9,bold=false,color=ink,align:'left'|'right'='left')=>{doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color).text(s,x,y,{width:w,align,lineBreak:false,ellipsis:true});};
   const format=(v:string|number,i:number)=>typeof v==='number'?v.toLocaleString('en-LK',{minimumFractionDigits:report.moneyColumns?.includes(i)?2:0,maximumFractionDigits:2}):String(v??'');
   const weights=report.headers.map(h=>/description|address|customer|supplier|product|notes|reference/i.test(h)?1.65:1);
   const sum=weights.reduce((a,b)=>a+b,0), widths=weights.map(w=>width*w/sum);
   let y=0;
   const header=()=>{
    if(logo){try{doc.image(logo,left,22,{fit:[78,45]});}catch{text('ARS',left,28,78,24,true,navy);}}
    else text('ARS',left,28,78,24,true,navy);
    text(brand.name,left+90,22,width-95,18,true,navy);
    text([brand.address,brand.phone].filter(Boolean).join(' | '),left+90,46,width-95,9);
    doc.rect(left,72,width,3).fill(gold);
    text(report.title,left,85,width,15,true,navy);
    text(report.period,left,106,width,9);
    y=126;
   };
   const tableHeader=()=>{
    doc.rect(left,y,width,31).fill(navy);let x=left;
    report.headers.forEach((h,i)=>{doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF').text(h,x+4,y+5,{width:widths[i]-8,height:24,ellipsis:true});x+=widths[i];});y+=31;
   };
   header();
   const metrics=report.summary||[];
   for(let i=0;i<metrics.length;i+=4){
    const group=metrics.slice(i,i+4),w=(width-24)/4;
    group.forEach((m,j)=>{const x=left+j*(w+8);doc.roundedRect(x,y,w,44,3).fill('#F0F4F8');doc.rect(x,y,3,44).fill(gold);text(m.label,x+8,y+7,w-16,8);text(format(m.value,-1),x+8,y+21,w-16,13,true,navy);});y+=52;
   }
   tableHeader();
   for(let index=0;index<report.rows.length;index++){
    const values=report.headers.map((_,i)=>format(report.rows[index][i]??'',i));
    doc.font('Helvetica').fontSize(8);
    const heights=values.map((v,i)=>doc.heightOfString(v,{width:widths[i]-8,lineGap:1}));
    const maxHeight=Math.max(20,...heights.map(h=>Math.ceil(h)+10));
    // Split oversized rows into continuation slices rather than clipping business descriptions.
    const capacity=bottom-157;
    if(maxHeight>capacity){
     throw new Error('A report row is too long for the PDF page. Export Excel for the complete record.');
    }
    if(y+maxHeight>bottom){doc.addPage();header();tableHeader();}
    if(index%2===0)doc.rect(left,y,width,maxHeight).fill('#F0F4F8');
    let x=left;
    values.forEach((v,i)=>{doc.font('Helvetica').fontSize(8).fillColor(ink).text(v,x+4,y+5,{width:widths[i]-8,lineGap:1,align:typeof report.rows[index][i]==='number'?'right':'left'});x+=widths[i];});
    y+=maxHeight;
   }
   if(!report.rows.length)text('No matching records',left,y+12,width,10);
   const range=doc.bufferedPageRange();
   for(let i=0;i<range.count;i++){
    doc.switchToPage(range.start+i);
    const fy=doc.page.height-36;
    doc.rect(left,fy-6,width,1).fill(gold);
    text(brand.name+' | Confidential | '+report.rows.length+' records',left,fy,width/2,8);
    text('RS NEXTWARD',left+width/2,fy,width/2,10,true,navy,'right');
    text('Powered by RS Nextward | Page '+(i+1)+' of '+range.count,left,fy+12,width,8,false,ink,'right');
   }
   doc.end();
  }catch(e){doc.destroy();reject(e);}
 });
}
