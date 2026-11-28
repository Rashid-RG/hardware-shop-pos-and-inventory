import type {Pool} from 'pg';

/** Read-only bank availability at server-derived business date. Not a reservation. */
export async function listStatutoryBankAvailability(db:Pool,shopId:string,day:string){
 if(!shopId||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Valid shop and business date required.');
 return (await db.query(`SELECT a.id,a.name,
 COALESCE(m.balance,0)::text AS balance,COALESCE(c.commitments,0)::text AS commitments,
 (COALESCE(m.balance,0)-COALESCE(c.commitments,0))::text AS available,
 COALESCE(m.future,FALSE) AS future_movements
 FROM ars_financial_accounts a
 LEFT JOIN LATERAL(SELECT SUM(amount) FILTER(WHERE effective_date<=$2::date) AS balance,BOOL_OR(effective_date>$2::date) AS future FROM ars_financial_movements WHERE shop_id=a.shop_id AND account_id=a.id) m ON TRUE
 LEFT JOIN LATERAL(SELECT SUM(amount) AS commitments FROM ars_supplier_cheques WHERE shop_id=a.shop_id AND bank_account_id=a.id AND status='Issued') c ON TRUE
 WHERE a.shop_id=$1 AND a.active AND a.kind='Bank' ORDER BY a.name,a.id`,[shopId,day])).rows;
}
