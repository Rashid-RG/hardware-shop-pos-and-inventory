import type { BusinessReport } from './businessReport';
export type ReportChart={title:string;label:string;points:{name:string;value:number}[]};
export function buildReportChart(report:BusinessReport):ReportChart|null{
 const h=report.headers;
 // Count by status, category or type first; never add incompatible monetary measures.
 const group=h.findIndex(v=>/^(status|category|record type|type|attendance|role|payment)$/i.test(v));
 if(group>=0){
  const totals=new Map<string,number>();
  for(const row of report.rows){const key=String(row[group]??'').trim()||'Not recorded';totals.set(key,(totals.get(key)||0)+1);}
  const sorted=[...totals].sort((a,b)=>b[1]-a[1]);
  const points=sorted.slice(0,10).map(([name,value])=>({name,value}));
  if(sorted.length>10)points.push({name:'Other categories (combined)',value:sorted.slice(10).reduce((a,b)=>a+b[1],0)});
  return points.length?{title:'Records by '+h[group],label:'Record count',points}:null;
 }
 const product=h.findIndex(v=>v==='Product');
 const revenue=h.findIndex(v=>/^Revenue \(LKR\)$/.test(v));
 if(product>=0&&revenue>=0){
  const totals=new Map<string,number>();
  for(const row of report.rows){const value=row[revenue];if(typeof value!=='number'||!Number.isFinite(value))continue;const key=String(row[product]??'');totals.set(key,(totals.get(key)||0)+value);}
  const points=[...totals].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,value])=>({name,value}));
  return points.length?{title:'Top products by revenue',label:'Revenue (LKR)',points}:null;
 }
 const name=h.findIndex(v=>v==='Shop name');
 const outstanding=h.findIndex(v=>v==='Outstanding (LKR)');
 if(name>=0&&outstanding>=0){
  const points=report.rows.filter(r=>typeof r[outstanding]==='number'&&Number.isFinite(r[outstanding])&&Number(r[outstanding])>0).sort((a,b)=>Number(b[outstanding])-Number(a[outstanding])).slice(0,10).map(r=>({name:String(r[name]),value:Number(r[outstanding])}));
  return points.length?{title:'Largest outstanding customer balances',label:'Outstanding (LKR)',points}:null;
 }
 return null;
}
const esc=(s:unknown)=>String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function nativeChartXml(chart:ReportChart,start:number){
 const end=start+chart.points.length-1;
 const cats=chart.points.map((p,i)=>'<c:pt idx="'+i+'"><c:v>'+esc(p.name)+'</c:v></c:pt>').join('');
 const vals=chart.points.map((p,i)=>'<c:pt idx="'+i+'"><c:v>'+p.value+'</c:v></c:pt>').join('');
 return '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>'+esc(chart.title)+'</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>'+esc(chart.label)+'</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="D6A62C"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>Overview!$A$'+start+':$A$'+end+'</c:f><c:strCache><c:ptCount val="'+chart.points.length+'"/>'+cats+'</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Overview!$B$'+start+':$B$'+end+'</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="'+chart.points.length+'"/>'+vals+'</c:numCache></c:numRef></c:val></c:ser><c:axId val="101"/><c:axId val="102"/></c:barChart><c:catAx><c:axId val="101"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:axPos val="l"/><c:tickLblPos val="nextTo"/><c:crossAx val="102"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="102"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:majorGridlines/><c:numFmt formatCode="#,##0.##" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="101"/><c:crosses val="max"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>';
}
