import type {PoolClient} from 'pg';
import {moneyCents,validateJournal,type JournalLine} from './generalLedger';

type Journal={id:string;shopId:string;postingDate:string;sourceKind:string;sourceId:string;description:string;actor:string;lines:JournalLine[]};
const format=(n:bigint)=>(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');
const validDay=(day:string)=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day&&day>='1900-01-01';

/** Internal primitive: caller must own a transaction and roll back on any error.
 * No operational route calls this yet. No historical backfill. */
export async function postJournal(client:PoolClient,input:Journal){
 if(![input.id,input.shopId,input.sourceKind,input.sourceId,input.description,input.actor].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)||!validDay(input.postingDate))throw Error('Valid journal identity, date and evidence required.');
 validateJournal(input.lines);
 const lines=input.lines.map(l=>({accountCode:l.accountCode,debit:format(moneyCents(l.debit)),credit:format(moneyCents(l.credit))}));
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ars-gl-period:'+input.shopId]);
 const previous=await client.query('SELECT id,posting_date::text AS day,source_kind,source_id,description,recorded_by FROM ars_gl_journals WHERE shop_id=$1 AND (id=$2 OR (source_kind=$3 AND source_id=$4))',[input.shopId,input.id,input.sourceKind,input.sourceId]);
 if(previous.rowCount){
  const p=previous.rows[0];
  const existing=(await client.query('SELECT account_code AS "accountCode",debit::text,credit::text FROM ars_gl_lines WHERE shop_id=$1 AND journal_id=$2 ORDER BY line_no',[input.shopId,p.id])).rows;
  if(previous.rowCount!==1||p.id!==input.id||p.day!==input.postingDate||p.source_kind!==input.sourceKind||p.source_id!==input.sourceId||p.description!==input.description||p.recorded_by!==input.actor||existing.length!==lines.length||!lines.every((l,i)=>l.accountCode===existing[i].accountCode&&l.debit===existing[i].debit&&l.credit===existing[i].credit))throw Error('Journal identity or source already used with different details.');
  return {id:p.id,replayed:true};
 }
 await client.query('INSERT INTO ars_gl_journals(shop_id,id,posting_date,source_kind,source_id,description,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.shopId,input.id,input.postingDate,input.sourceKind,input.sourceId,input.description,input.actor]);
 for(const [index,l] of lines.entries())await client.query('INSERT INTO ars_gl_lines(shop_id,journal_id,line_no,account_code,debit,credit) VALUES($1,$2,$3,$4,$5,$6)',[input.shopId,input.id,index+1,l.accountCode,l.debit,l.credit]);
 return {id:input.id,replayed:false};
}

/** Reversal only, not a mutation of an original journal. One reversal per original. */
export async function reverseJournal(client:PoolClient,input:{shopId:string;id:string;originalId:string;postingDate:string;actor:string;reason:string}){
 if(!input.reason?.trim()||input.reason.trim().length>450)throw Error('Reversal evidence required.');
 const original=await client.query('SELECT posting_date::text AS day,source_kind FROM ars_gl_journals WHERE shop_id=$1 AND id=$2',[input.shopId,input.originalId]);
 if(!original.rowCount||original.rows[0].source_kind==='Reversal'||original.rows[0].source_kind==='Opening'||input.postingDate<original.rows[0].day)throw Error('Journal cannot be reversed in this manner.');
 const lines=(await client.query('SELECT account_code AS "accountCode",credit::text AS debit,debit::text AS credit FROM ars_gl_lines WHERE shop_id=$1 AND journal_id=$2 ORDER BY line_no',[input.shopId,input.originalId])).rows;
 return postJournal(client,{id:input.id,shopId:input.shopId,postingDate:input.postingDate,sourceKind:'Reversal',sourceId:input.originalId,description:input.reason.trim(),actor:input.actor,lines});
}
