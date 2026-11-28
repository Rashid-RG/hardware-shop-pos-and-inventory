import type {Pool} from 'pg';
const day=(s:string)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
function decimal(n:bigint){const sign=n<0n?'-':'';const a=n<0n?-n:n;return sign+(a/100n).toString()+'.'+(a%100n).toString().padStart(2,'0');}
const cents=(s:string)=>BigInt(s.replace('.',''));
/** Cumulative statements from cutover, not certified operational reconciliation. */
export async function ledgerStatements(db:Pool,shopId:string,asOf:string){
 if(!shopId?.trim()||!day(asOf))throw Error('Valid shop and reporting date required.');
 const client=await db.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const config=(await client.query('SELECT cutover_date::text AS day,posting_enabled FROM ars_gl_cutover WHERE shop_id=$1',[shopId])).rows[0];
  const rows=(await client.query(`SELECT a.code,a.name,a.kind,a.active,
   COALESCE(SUM(l.debit) FILTER(WHERE j.id IS NOT NULL),0)::numeric(24,2)::text AS debit,
   COALESCE(SUM(l.credit) FILTER(WHERE j.id IS NOT NULL),0)::numeric(24,2)::text AS credit
   FROM ars_gl_accounts a LEFT JOIN ars_gl_lines l ON l.shop_id=a.shop_id AND l.account_code=a.code
   LEFT JOIN ars_gl_journals j ON j.shop_id=l.shop_id AND j.id=l.journal_id AND j.posting_date<=$2::date
   WHERE a.shop_id=$1 GROUP BY a.code,a.name,a.kind,a.active ORDER BY a.code`,[shopId,asOf])).rows;
  const counts=(await client.query("SELECT count(*)::text AS count,count(*) FILTER(WHERE source_kind='Opening')::text AS openings FROM ars_gl_journals WHERE shop_id=$1 AND posting_date<=$2::date",[shopId,asOf])).rows[0];
  let debit=0n,credit=0n,assets=0n,liabilities=0n,equity=0n,revenue=0n,expenses=0n,trialDebit=0n,trialCredit=0n;
  const accounts=rows.map(r=>{
   const d=cents(r.debit),c=cents(r.credit),net=d-c;debit+=d;credit+=c;
   if(net>0n)trialDebit+=net;else trialCredit-=net;
   if(r.kind==='Asset')assets+=net;else if(r.kind==='Liability')liabilities-=net;else if(r.kind==='Equity')equity-=net;else if(r.kind==='Revenue')revenue-=net;else if(r.kind==='Expense')expenses+=net;
   return {...r,balance:decimal(net),trialDebit:decimal(net>0n?net:0n),trialCredit:decimal(net<0n?-net:0n)};
  });
  const profit=revenue-expenses;
  const available=!!config?.posting_enabled&&asOf>=config.day&&counts.openings==='1';
  await client.query('COMMIT');
  return {asOf,cutoverDate:config?.day??null,postingEnabled:!!config?.posting_enabled,journalCount:counts.count,openingCount:counts.openings,accounts,
   trialBalance:{movementDebit:decimal(debit),movementCredit:decimal(credit),debit:decimal(trialDebit),credit:decimal(trialCredit),difference:decimal(debit-credit)},
   profitAndLoss:available?{revenue:decimal(revenue),expenses:decimal(expenses),netProfit:decimal(profit)}:null,
   balanceSheet:available?{assets:decimal(assets),liabilities:decimal(liabilities),recordedEquity:decimal(equity),cumulativeProfit:decimal(profit),totalEquity:decimal(equity+profit),difference:decimal(assets-liabilities-equity-profit)}:null,
   operationallyReconciled:false,complete:false,note:'Ledger-only cumulative balances. Not a certified balance sheet; operational completeness, mapping and cutover reconciliation are unverified.'};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function ledgerActivity(db:Pool,shopId:string,from:string,to:string,offset:number){
 if(!shopId?.trim()||!day(from)||!day(to)||from>to||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw Error('Valid reporting range and page required.');
 return (await db.query(`WITH selected AS (SELECT * FROM ars_gl_journals WHERE shop_id=$1 AND posting_date BETWEEN $2::date AND $3::date ORDER BY posting_date,id LIMIT 50 OFFSET $4)
 SELECT j.id,j.posting_date::text AS day,j.source_kind,j.source_id,j.description,j.recorded_by,
 (SELECT jsonb_agg(jsonb_build_object('accountCode',l.account_code,'debit',l.debit::text,'credit',l.credit::text) ORDER BY l.line_no) FROM ars_gl_lines l WHERE l.shop_id=j.shop_id AND l.journal_id=j.id) AS lines
 FROM selected j ORDER BY j.posting_date,j.id`,[shopId,from,to,offset])).rows;
}
