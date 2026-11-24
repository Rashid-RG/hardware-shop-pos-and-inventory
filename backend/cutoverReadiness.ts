import type {Pool} from 'pg';
import {openingReconciliation} from './openingReconciliation';
import {controlMappings} from './ledgerMappings';
import {validateJournal,type JournalLine} from './generalLedger';

type Check={code:string;status:'Passed'|'Blocked'|'Review';detail:string};
export async function cutoverReadiness(db:Pool,shopId:string,proposalId:string){
 if(!shopId?.trim()||typeof proposalId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(proposalId))throw Error('Valid opening proposal required.');
 const comparison=await openingReconciliation(db,shopId,proposalId);
 const client=await db.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const p=(await client.query('SELECT p.lines,p.total_cents::text AS total,p.submitted_by,r.decision,r.reviewed_by FROM ars_gl_opening_proposals p LEFT JOIN ars_gl_opening_reviews r ON r.shop_id=p.shop_id AND r.proposal_id=p.id WHERE p.shop_id=$1 AND p.id=$2',[shopId,proposalId])).rows[0];
  if(!p)throw Error('Opening proposal not found in this shop.');
  const checks:Check[]=[];
  const check=(code:string,pass:boolean,detail:string)=>checks.push({code,status:pass?'Passed':'Blocked',detail});
  const lines=p.lines as JournalLine[];
  check('proposal_integrity',validateJournal(lines).totalCents===p.total&&new Set(lines.map(l=>l.accountCode)).size===lines.length,'Balanced opening proposal and unique account lines.');
  check('independent_approval',p.decision==='Approved'&&p.reviewed_by!==p.submitted_by,'Independent administrator approval is required.');
  check('cutover_date',comparison.cutoverDate===comparison.asOf,'Current comparison date must match the proposed cutover date.');
  const docs=(await client.query('SELECT id,snapshot_hash,recorded_by,recorded_at FROM ars_gl_documentary_reviews WHERE shop_id=$1 AND proposal_id=$2 ORDER BY recorded_at DESC,id DESC LIMIT 1',[shopId,proposalId])).rows[0];
  check('documentary_snapshot',!!docs&&docs.snapshot_hash===comparison.snapshotHash&&docs.recorded_by!==p.submitted_by,'Latest independent documentary review must match the current comparison fingerprint.');
  const mappings=(await client.query('SELECT m.mapping_kind,m.source_id,m.account_code,a.kind,a.active FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1',[shopId])).rows;
  const missing=Object.entries(controlMappings).filter(([kind,classification])=>!mappings.some(m=>m.mapping_kind===kind&&m.source_id==='control'&&m.kind===classification&&m.active)).map(([kind])=>kind);
  check('control_mappings',missing.length===0,missing.length?'Missing or invalid control mappings: '+missing.join(', '):'Required control mappings exist and are active.');
  const unresolved=comparison.rows.filter(r=>r.status==='Unmapped'||(r.difference!==null&&r.difference!=='0.00'));
  check('comparison_differences',unresolved.length===0,unresolved.length+' unmapped or differing comparison rows.');
  check('inventory',comparison.inventoryIssues===0,comparison.inventoryIssues+' inventory valuation issues.');
  check('suppliers',comparison.supplierIssues===0,comparison.supplierIssues+' supplier operational issues; documentary invoice verification remains required.');
  const config=(await client.query('SELECT posting_enabled FROM ars_gl_cutover WHERE shop_id=$1',[shopId])).rows[0];
  const journalCount=(await client.query('SELECT count(*)::text AS count FROM ars_gl_journals WHERE shop_id=$1',[shopId])).rows[0].count;
  check('unused_ledger',!config?.posting_enabled&&journalCount==='0','Initial cutover requires an inactive ledger with no existing journals.');
  // These are deliberate hard blockers, not user-supplied flags.
  check('operational_posting_coverage',false,'Sales, purchases, inventory, payments, cheques, transfers, expenses and partner events are not yet fully integrated and tested.');
  check('transactional_cutover',false,'Final verification under a transactionally protected maintenance boundary is not implemented.');
  check('independent_certification',false,'Document references and report comparisons do not certify historical balances or prove documentary completeness.');
  await client.query('COMMIT');
  return {proposalId,cutoverDate:comparison.cutoverDate,asOf:comparison.asOf,snapshotHash:comparison.snapshotHash,checks,blocked:checks.filter(c=>c.status==='Blocked').length,activationAllowed:false,postingEnabled:!!config?.posting_enabled,note:'Read-only diagnostics from separate observations, not a transactional activation authorization.'};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
