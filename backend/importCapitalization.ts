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
