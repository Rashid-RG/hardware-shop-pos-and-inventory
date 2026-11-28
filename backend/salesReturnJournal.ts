import {moneyCents,validateJournal,type JournalLine} from './generalLedger';
import {decimal} from './supplierAdvance';

/** Inputs must come from reconciled immutable invoice amounts, not the current
 * product catalogue. Net revenue and tax must already include allocated discounts. */
export function allocateSalesReturn(input:{soldQuantity:number;unitsPerSaleUnit:number;previousReturnedBaseQuantity:number;returnBaseQuantity:number;netRevenue:string;tax:string;inventoryCost:string}){
 const {soldQuantity,unitsPerSaleUnit,previousReturnedBaseQuantity:previous,returnBaseQuantity:quantity}=input;
 if(![soldQuantity,unitsPerSaleUnit,previous,quantity].every(Number.isSafeInteger)||soldQuantity<=0||unitsPerSaleUnit<=0||previous<0||quantity<=0)throw Error('Valid whole return quantities required.');
 const base=soldQuantity*unitsPerSaleUnit;
 if(!Number.isSafeInteger(base)||quantity>base-previous)throw Error('Return exceeds original sold quantity.');
 const allocate=(value:string)=>{const cents=moneyCents(value);return cents*BigInt(previous+quantity)/BigInt(base)-cents*BigInt(previous)/BigInt(base);};
 const revenue=allocate(input.netRevenue),tax=allocate(input.tax),cost=allocate(input.inventoryCost);
 return {baseQuantity:quantity,revenue,tax,cost,customerCredit:revenue+tax,remainingBaseQuantity:base-previous-quantity};
}

/** Credit outstanding receivables first. Excess becomes a customer liability,
 * never an assumed cash refund. Only sellable returned stock is restored here. */
export function buildSalesReturnJournal(input:{netRevenue:string;tax:string;inventoryCost:string;outstandingReceivable:string;salesAccount:string;taxAccount:string;inventoryAccount:string;costOfGoodsAccount:string;receivablesAccount:string;customerCreditsAccount:string}):JournalLine[]{
 const revenue=moneyCents(input.netRevenue),tax=moneyCents(input.tax),cost=moneyCents(input.inventoryCost),outstanding=moneyCents(input.outstandingReceivable);
 const total=revenue+tax,applied=total<outstanding?total:outstanding,credit=total-applied;
 const lines:JournalLine[]=[];
 const add=(accountCode:string,debit:bigint,cr:bigint)=>{if(debit||cr)lines.push({accountCode,debit:decimal(debit),credit:decimal(cr)});};
 add(input.salesAccount,revenue,0n);add(input.taxAccount,tax,0n);add(input.receivablesAccount,0n,applied);add(input.customerCreditsAccount,0n,credit);
 add(input.inventoryAccount,cost,0n);add(input.costOfGoodsAccount,0n,cost);
 if(new Set(lines.map(l=>l.accountCode)).size!==lines.length)throw Error('Distinct sales return accounts required.');
 validateJournal(lines);return lines;
}
