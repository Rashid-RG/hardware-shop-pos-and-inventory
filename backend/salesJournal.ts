import {moneyCents,validateJournal,type JournalLine} from './generalLedger';

type InvoiceAmounts={total:string;tax:string;items:{quantity:number;costPerSellingUnit:string}[]};
type InvoiceAccounts={destination:string;sales:string;tax:string;inventory:string;costOfGoods:string};
const decimal=(n:bigint)=>(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');

/** Amounts must come from persisted server-validated invoice records.
 * Destination is receivables for credit sales, or the actual mapped financial account.
 * Costs are per invoiced selling unit, including Box/Piece conversion already applied.
 * No inventory or operational mutations occur here. */
export function buildSalesJournal(invoice:InvoiceAmounts,accounts:InvoiceAccounts):JournalLine[]{
 const total=moneyCents(invoice.total),tax=moneyCents(invoice.tax);
 if(total<=0n||tax>total)throw Error('Positive invoice total and valid tax required.');
 if(!Array.isArray(invoice.items)||!invoice.items.length)throw Error('Invoice items required for accounting.');
 let cost=0n;
 for(const item of invoice.items){
  if(!Number.isSafeInteger(item.quantity)||item.quantity<=0)throw Error('Invalid invoice quantity for accounting.');
  const unitCost=moneyCents(item.costPerSellingUnit);
  if(unitCost<=0n)throw Error('Verified positive inventory cost required before accounting posting.');
  cost+=unitCost*BigInt(item.quantity);
 }
 const revenue=total-tax;
 if(revenue<=0n)throw Error('Positive net sales revenue required.');
 const codes=[accounts.destination,accounts.sales,accounts.inventory,accounts.costOfGoods,...(tax>0n?[accounts.tax]:[])];
 if(codes.some(c=>typeof c!=='string'||!/^\d{4,10}$/.test(c))||new Set(codes).size!==codes.length)throw Error('Distinct valid sales accounting mappings required.');
 const line=(accountCode:string,debit:bigint,credit:bigint):JournalLine=>({accountCode,debit:decimal(debit),credit:decimal(credit)});
 const lines=[line(accounts.destination,total,0n),line(accounts.sales,0n,revenue)];
 if(tax>0n)lines.push(line(accounts.tax,0n,tax));
 lines.push(line(accounts.costOfGoods,cost,0n),line(accounts.inventory,0n,cost));
 validateJournal(lines);
 return lines;
}
