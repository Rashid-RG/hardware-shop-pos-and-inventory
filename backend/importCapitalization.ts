import {type JournalLine,validateJournal} from './generalLedger';
import {decimal} from './supplierAdvance';

/** Fully funded charges only. Unpaid charges need a separate liability workflow.
 * rounding = new carrying value minus previous carrying value minus receipt cost.
 * Expense credits reclassify previously posted operating expenses, never cash twice.
 */
export function buildImportReceiptJournal(input:{goods:bigint;landed:bigint;rounding:bigint;verifiedUnusedCharges:bigint;goodsCredits:JournalLine[];inventoryAccount:string;expenseAccount:string;roundingAccount:string}):JournalLine[]{
 const {goods,landed,rounding,verifiedUnusedCharges,goodsCredits,inventoryAccount,expenseAccount,roundingAccount}=input;
 if(goods<=0n||landed<goods||verifiedUnusedCharges<0n||landed-goods>verifiedUnusedCharges||landed+rounding<=0n)throw Error('Verified import charge funding and inventory value required.');
 const charges=landed-goods;
 const lines:JournalLine[]=[{accountCode:inventoryAccount,debit:decimal(landed+rounding),credit:'0.00'},...goodsCredits];
 if(charges>0n)lines.push({accountCode:expenseAccount,debit:'0.00',credit:decimal(charges)});
 if(rounding!==0n)lines.push({accountCode:roundingAccount,debit:decimal(rounding<0n?-rounding:0n),credit:decimal(rounding>0n?rounding:0n)});
 if(new Set(lines.map(l=>l.accountCode)).size!==lines.length)throw Error('Distinct import ledger accounts required.');
 validateJournal(lines);
 return lines;
}

import type {PoolClient} from 'pg';
import {moneyCents} from './generalLedger';

/** Require whole approved charge funding, proven by original expense journals.
 * The PO is locked by the receiving transaction; lock the approval against concurrent linking.
 */
export async function verifiedImportChargeBalance(client:PoolClient,shopId:string,poId:string,expenseAccount:string){
 const a=(await client.query('SELECT id,charges_total::text,snapshot FROM ars_landed_cost_approvals WHERE shop_id=$1 AND purchase_order_id=$2 FOR UPDATE',[shopId,poId])).rows[0];
 if(!a)throw Error('Approved landed cost required.');
 const links=(await client.query(`SELECT x.charge_kind,x.amount::text,x.expense_id,j.id AS journal_id,
 (SELECT COALESCE(sum(l.debit-l.credit),0)::numeric(24,2)::text FROM ars_gl_lines l WHERE l.shop_id=x.shop_id AND l.journal_id=j.id AND l.account_code=$3) AS posted
 FROM ars_import_expense_links x LEFT JOIN ars_gl_journals j ON j.shop_id=x.shop_id AND j.source_kind='Expense' AND j.source_id=x.expense_id
 WHERE x.shop_id=$1 AND x.approval_id=$2`,[shopId,a.id,expenseAccount])).rows;
 const caps:Record<string,bigint>={Freight:moneyCents(String(a.snapshot.freightLkr)),Customs:moneyCents(String(a.snapshot.customsLkr)),Clearance:moneyCents(String(a.snapshot.clearanceLkr))};
 const paid:Record<string,bigint>={Freight:0n,Customs:0n,Clearance:0n};
 for(const l of links){
  if(!l.journal_id||!Object.prototype.hasOwnProperty.call(paid,l.charge_kind)||moneyCents(l.amount)!==moneyCents(l.posted))throw Error('Import expense must have matching posted operating expense.');
  paid[l.charge_kind]+=moneyCents(l.amount);
 }
 for(const k of Object.keys(caps))if(paid[k]!==caps[k])throw Error('All approved import charges must be funded and linked before receiving.');
 const funded=paid.Freight+paid.Customs+paid.Clearance;
 if(funded!==moneyCents(a.charges_total))throw Error('Approved charges do not reconcile.');
 const used=(await client.query(`SELECT COALESCE(sum(l.credit-l.debit),0)::numeric(24,2)::text AS used
 FROM ars_gl_journals j JOIN ars_gl_lines l ON l.shop_id=j.shop_id AND l.journal_id=j.id
 JOIN ars_receipt_batches b ON b.shop_id=j.shop_id AND b.id=j.source_id
 WHERE j.shop_id=$1 AND j.source_kind='ReceiptBatch' AND b.purchase_order_id=$2 AND l.account_code=$3`,[shopId,poId,expenseAccount])).rows[0].used;
 const remaining=funded-moneyCents(used);
 if(remaining<0n)throw Error('Import charges already overallocated.');
 return remaining;
}

/** Allocate a receipt's import charges between already funded amounts and
 * documented unpaid obligations. Never infer a creditor from the goods supplier.
 * Liability approval and settlement records must be verified by the caller.
 */
export function allocateImportChargeFunding(input:{charges:bigint;fundedRemaining:bigint;approvedUnpaidRemaining:bigint}){
 const {charges,fundedRemaining,approvedUnpaidRemaining}=input;
 if(charges<0n||fundedRemaining<0n||approvedUnpaidRemaining<0n||charges>fundedRemaining+approvedUnpaidRemaining)throw Error('Import charges exceed documented funding and obligations.');
 const paid=charges<fundedRemaining?charges:fundedRemaining;
 return {paid,unpaid:charges-paid};
}
export function buildImportLiabilityReceiptJournal(input:{goods:bigint;landed:bigint;rounding:bigint;fundedRemaining:bigint;approvedUnpaidRemaining:bigint;goodsCredits:JournalLine[];inventoryAccount:string;expenseAccount:string;roundingAccount:string;importPayableAccount:string}):JournalLine[]{
 const {goods,landed,rounding,goodsCredits,inventoryAccount,expenseAccount,roundingAccount,importPayableAccount}=input;
 if(goods<=0n||landed<goods||landed+rounding<=0n)throw Error('Verified goods and inventory value required.');
 const {paid,unpaid}=allocateImportChargeFunding({charges:landed-goods,fundedRemaining:input.fundedRemaining,approvedUnpaidRemaining:input.approvedUnpaidRemaining});
 if(goodsCredits.some(l=>moneyCents(l.debit)!==0n)||goodsCredits.reduce((sum,l)=>sum+moneyCents(l.credit),0n)!==goods)throw Error('Goods credits must equal verified goods cost.');
 const lines:JournalLine[]=[{accountCode:inventoryAccount,debit:decimal(landed+rounding),credit:'0.00'},...goodsCredits];
 if(paid>0n)lines.push({accountCode:expenseAccount,debit:'0.00',credit:decimal(paid)});
 if(unpaid>0n)lines.push({accountCode:importPayableAccount,debit:'0.00',credit:decimal(unpaid)});
 if(rounding!==0n)lines.push({accountCode:roundingAccount,debit:decimal(rounding<0n?-rounding:0n),credit:decimal(rounding>0n?rounding:0n)});
 if(new Set(lines.map(l=>l.accountCode)).size!==lines.length)throw Error('Distinct import ledger accounts required.');
 validateJournal(lines);return lines;
}
