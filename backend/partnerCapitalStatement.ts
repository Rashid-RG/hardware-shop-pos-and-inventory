import type {Pool,PoolClient} from 'pg';
const validDay=(d:string)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d&&d>='1900-01-01';
export async function partnerCapitalStatement(db:Pool|PoolClient,i:{shopId:string;partnerId:string;fromDate:string;toDate:string;limit:number;offset:number}){
 const {shopId,partnerId,fromDate,toDate,limit,offset}=i;
 if(!shopId||!partnerId||!validDay(fromDate)||!validDay(toDate)||fromDate>toDate||!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw Error('Invalid partner statement filters.');
 const r=(await db.query(`
 WITH partner AS (SELECT id,name,is_active FROM ars_business_partners WHERE shop_id=$1 AND id=$2),
 entries AS (
 SELECT e.id,e.entry_date,e.created_at,e.entry_type,e.amount_lkr,e.reference,e.note,e.created_by,
 CASE WHEN e.entry_type='Contribution' THEN e.amount_lkr ELSE -e.amount_lkr END AS signed,
 a.name AS financial_account_name,m.id AS movement_id,j.id AS journal_id,
 CASE WHEN m.id IS NULL AND j.id IS NULL THEN 'Historical'
 WHEN m.id='partner-capital:'||e.id AND j.id='partner-capital:'||e.id
 AND m.amount=CASE WHEN e.entry_type='Contribution' THEN e.amount_lkr ELSE -e.amount_lkr END
 AND m.effective_date=e.entry_date AND j.posting_date=e.entry_date AND m.recorded_by=e.created_by AND j.recorded_by=e.created_by
 AND (SELECT COUNT(*) FROM ars_gl_lines l WHERE l.shop_id=j.shop_id AND l.journal_id=j.id)=2
 AND (SELECT COALESCE(SUM(l.debit),0)=e.amount_lkr AND COALESCE(SUM(l.credit),0)=e.amount_lkr FROM ars_gl_lines l WHERE l.shop_id=j.shop_id AND l.journal_id=j.id)
 AND (SELECT COUNT(*) FROM ars_financial_movements x WHERE x.shop_id=e.shop_id AND x.source_id=e.id AND x.movement_kind='Partner Capital')=1
 THEN 'Posted' ELSE 'Review required' END AS posting_status,
 v.decision AS latest_review
 FROM ars_partner_capital_entries e JOIN partner p ON p.id=e.partner_id
 LEFT JOIN LATERAL (SELECT x.* FROM ars_financial_movements x WHERE x.shop_id=e.shop_id AND x.source_id=e.id AND x.movement_kind='Partner Capital' ORDER BY x.id LIMIT 1) m ON TRUE
 LEFT JOIN ars_financial_accounts a ON a.shop_id=e.shop_id AND a.id=m.account_id
 LEFT JOIN ars_gl_journals j ON j.shop_id=e.shop_id AND j.source_id=e.id AND j.source_kind='PartnerCapital'
 LEFT JOIN LATERAL (SELECT decision FROM ars_gl_partner_capital_reviews x WHERE x.shop_id=e.shop_id AND x.entry_id=e.id ORDER BY reviewed_at DESC,request_id DESC LIMIT 1) v ON TRUE
 WHERE e.shop_id=$1 AND e.entry_date<=$4::date
 ), opening AS (SELECT COALESCE(SUM(signed),0) AS balance FROM entries WHERE entry_date<$3::date),
 period AS (SELECT *, (SELECT balance FROM opening)+SUM(signed) OVER(ORDER BY entry_date,created_at,id ROWS UNBOUNDED PRECEDING) AS running_balance FROM entries WHERE entry_date BETWEEN $3::date AND $4::date),
 totals AS (SELECT COUNT(*) AS count,COALESCE(SUM(amount_lkr) FILTER(WHERE entry_type='Contribution'),0) AS contributions,COALESCE(SUM(amount_lkr) FILTER(WHERE entry_type='Drawing'),0) AS drawings,COUNT(*) FILTER(WHERE posting_status='Posted') AS posted,COUNT(*) FILTER(WHERE posting_status='Historical') AS historical,COUNT(*) FILTER(WHERE posting_status='Review required') AS review FROM period),
 page AS (SELECT id,entry_date::text AS day,created_at,entry_type,amount_lkr::text AS amount,reference,note,created_by,financial_account_name,movement_id,journal_id,posting_status,latest_review,running_balance::text AS running_balance FROM period ORDER BY entry_date,created_at,id LIMIT $5 OFFSET $6)
 SELECT p.*,o.balance::text AS opening,t.count,t.contributions::text,t.drawings::text,(o.balance+t.contributions-t.drawings)::text AS closing,t.posted,t.historical,t.review,
 COALESCE((SELECT jsonb_agg(x ORDER BY x.day,x.created_at,x.id) FROM page x),'[]'::jsonb) AS rows
 FROM partner p CROSS JOIN opening o CROSS JOIN totals t
 `,[shopId,partnerId,fromDate,toDate,limit,offset])).rows[0];
 if(!r)throw Error('Partner not found in this shop.');
 return {partner:{id:r.id,name:r.name,active:r.is_active},fromDate,toDate,limit,offset,total:Number(r.count),opening:r.opening,contributions:r.contributions,drawings:r.drawings,closing:r.closing,posted:Number(r.posted),historical:Number(r.historical),review:Number(r.review),rows:r.rows,basis:'Recorded capital entries only; not a reconciled equity balance or profit entitlement.'};
}
