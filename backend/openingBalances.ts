import type {Pool,PoolClient} from 'pg';
import {moneyCents,validateJournal,type JournalLine} from './generalLedger';

type Proposal={id:string;cutoverDate:string;evidence:string;lines:JournalLine[]};
function decimal(cents:bigint){return (cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');}
export async function submitOpeningProposal(db:Pool,shopId:string,actor:string,input:Proposal){
 if(!shopId?.trim()||!actor?.trim()||!input||typeof input.id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(input.id)||typeof input.cutoverDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.cutoverDate)||!Number.isFinite(Date.parse(input.cutoverDate))||new Date(input.cutoverDate).toISOString().slice(0,10)!==input.cutoverDate||input.cutoverDate<'1900-01-01'||typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.trim().length>500)throw Error('Valid cutover date and supporting evidence required.');
 const {totalCents}=validateJournal(input.lines);
 const lines=input.lines.map(line=>({accountCode:line.accountCode,debit:decimal(moneyCents(line.debit)),credit:decimal(moneyCents(line.credit))})).sort((a,b)=>a.accountCode.localeCompare(b.accountCode));
 if(new Set(lines.map(l=>l.accountCode)).size!==lines.length)throw Error('Use one opening balance line per account.');
 const evidence=input.evidence.trim();
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['opening-proposal',shopId,input.id])]);
  const old=await client.query('SELECT cutover_date::text AS day,evidence,lines,submitted_by,total_cents::text AS total FROM ars_gl_opening_proposals WHERE shop_id=$1 AND id=$2',[shopId,input.id]);
  if(old.rowCount){
   const row=old.rows[0];
   const same=row.day===input.cutoverDate&&row.evidence===evidence&&row.submitted_by===actor&&row.total===totalCents&&Array.isArray(row.lines)&&row.lines.length===lines.length&&lines.every((l,i)=>l.accountCode===row.lines[i].accountCode&&l.debit===row.lines[i].debit&&l.credit===row.lines[i].credit);
   if(!same)throw Error('Opening proposal identifier already used.');
   await client.query('COMMIT');return {id:input.id,replayed:true,postingActivated:false};
  }
  const cutover=await client.query('SELECT 1 FROM ars_gl_cutover WHERE shop_id=$1 AND posting_enabled',[shopId]);
  if(cutover.rowCount)throw Error('Accounting already active; opening proposal not permitted.');
  const accounts=await client.query('SELECT code,kind,active FROM ars_gl_accounts WHERE shop_id=$1 AND code=ANY($2::text[]) ORDER BY code FOR SHARE',[shopId,lines.map(l=>l.accountCode)]);
  if(accounts.rowCount!==lines.length||accounts.rows.some(a=>!a.active||!['Asset','Liability','Equity'].includes(a.kind)))throw Error('Opening balances require active asset, liability or equity accounts in this shop.');
  await client.query('INSERT INTO ars_gl_opening_proposals(shop_id,id,cutover_date,evidence,lines,total_cents,submitted_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)',[shopId,input.id,input.cutoverDate,evidence,JSON.stringify(lines),totalCents,actor]);
  await client.query('COMMIT');return {id:input.id,replayed:false,postingActivated:false};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function listOpeningProposals(db:Pool|PoolClient,shopId:string){
 if(!shopId?.trim())throw Error('Shop required.');
 return (await db.query('SELECT id,cutover_date::text AS "cutoverDate",evidence,lines,total_cents::text AS "totalCents",submitted_by,submitted_at FROM ars_gl_opening_proposals WHERE shop_id=$1 ORDER BY submitted_at DESC,id DESC LIMIT 50',[shopId])).rows;
}
