import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildBusinessWorkbook } from '../src/utils/reportWorkbook';
import { renderBusinessReportPdf } from '../src/utils/businessReportPdf';
import type { BusinessReport } from '../src/utils/businessReport';

async function main() {
 const target=resolve(process.argv[2]||'report-compatibility-output');
 await mkdir(target,{recursive:true});
 const settings={storeName:'ARS Hardware TEST',taxRate:0,currency:'LKR',invoicePrefix:'TEST'};
 const report:BusinessReport={title:'Product performance compatibility test',filename:'ars-report-test',period:'Synthetic records only',headers:['Product','Units Sold','Revenue (LKR)','Profit (LKR)'],rows:Array.from({length:120},(_,i)=>['Sample product '+(i+1),i+1,(i+1)*125.5,(i+1)*25.25]),moneyColumns:[2,3],summary:[{label:'Synthetic records',value:120},{label:'Revenue (LKR)',value:911130}]};
 report.summary![1].value=report.rows.reduce((sum,row)=>sum+Number(row[2]),0);
 await writeFile(join(target,'ars-report-test.xlsx'),Buffer.from(await (await buildBusinessWorkbook(report,settings)).arrayBuffer()));
 await writeFile(join(target,'ars-report-test.pdf'),await renderBusinessReportPdf(report,{name:settings.storeName,address:'Synthetic test address',phone:'Test contact'},null));
 console.log('Synthetic report fixtures generated in '+target);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
