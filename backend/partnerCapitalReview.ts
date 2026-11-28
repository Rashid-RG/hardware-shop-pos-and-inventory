import type {Pool} from 'pg';

type Review={requestId:string;entryId:string;decision:'Included in opening balances'|'Discrepancy identified';evidence:string;openingJournalId?:string};
export async function reviewHistoricalCapital(db:Pool,shopId:string,actor:string,i:Review){
 if(!shopId||!actor||!i||typeof i.requestId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(i.requestId)||typeof i.entryId!=='string'||!i.entryId.trim()||i.entryId.length>200||!['Included in opening balances','Discrepancy identified'].includes(i.decision)||typeof i.evidence!=='string'||!i.evidence.trim()||i.evidence.trim().length>500)throw Error('Valid historical capital review and evidence required.');
 const opening=i.openingJournalId||null,evidence=i.evidence.trim();
 if((i.decision==='Included in opening balances')!==!!opening||opening!==null&&(typeof opening!=='string'||opening.length>200))throw Error('Opening journal required only for inclusion review.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['partner-capital-review:'+shopId+':'+i.requestId]);
  const old=(await c.query('SELECT entry_id,decision,evidence,opening_journal_id,reviewed_by FROM ars_gl_partner_capital_reviews WHERE shop_id=$1 AND request_id=$2',[shopId,i.requestId])).rows[0];
  if(old){
   if(old.entry_id!==i.entryId||old.decision!==i.decision||old.evidence!==evidence||old.opening_journal_id!==opening||old.reviewed_by!==actor)throw Error('Review request already used with different details.');
   await c.query('COMMIT');return {requestId:i.requestId,replayed:true};
  }
  const entry=(await c.query('SELECT id,partner_id,entry_type,amount_lkr::text AS amount,entry_date::text AS day,reference,note,created_by FROM ars_partner_capital_entries WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,i.entryId])).rows[0];
  if(!entry)throw Error('Historical capital entry not found.');
  if((await c.query("SELECT 1 FROM ars_financial_movements WHERE shop_id=$1 AND source_id=$2 AND movement_kind='Partner Capital' UNION ALL SELECT 1 FROM ars_gl_journals WHERE shop_id=$1 AND source_id=$2 AND source_kind='PartnerCapital'",[shopId,i.entryId])).rowCount)throw Error('Linked financial posting requires a different reconciliation workflow.');
  if(opening){
   const verified=(await c.query(`SELECT j.id FROM ars_gl_journals j JOIN ars_gl_cutover c ON c.shop_id=j.shop_id AND c.posting_enabled AND c.cutover_date=j.posting_date
    JOIN ars_gl_opening_proposals p ON p.shop_id=j.shop_id AND p.id=j.source_id AND p.cutover_date=j.posting_date
    JOIN ars_gl_opening_reviews r ON r.shop_id=p.shop_id AND r.proposal_id=p.id AND r.decision='Approved'
    WHERE j.shop_id=$1 AND j.id=$2 AND j.source_kind='Opening' AND $3::date<=j.posting_date`,[shopId,opening,entry.day])).rows[0];
   if(!verified)throw Error('Approved opening journal at accounting cutover required.');
  }
  await c.query('INSERT INTO ars_gl_partner_capital_reviews(shop_id,entry_id,request_id,decision,entry_snapshot,evidence,opening_journal_id,reviewed_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)',[shopId,i.entryId,i.requestId,i.decision,JSON.stringify(entry),evidence,opening,actor]);
  await c.query('COMMIT');return {requestId:i.requestId,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function listHistoricalCapitalReviews(db:Pool,shopId:string,entryId:string){
 return (await db.query('SELECT request_id,decision,entry_snapshot,evidence,opening_journal_id,reviewed_by,reviewed_at FROM ars_gl_partner_capital_reviews WHERE shop_id=$1 AND entry_id=$2 ORDER BY reviewed_at DESC,request_id DESC',[shopId,entryId])).rows;
}
