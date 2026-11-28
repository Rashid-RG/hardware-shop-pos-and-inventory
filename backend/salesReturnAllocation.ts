import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';

type OriginalLine={quantity:number;sellingPrice:string;discountPercent:string;discountAmount:string;costPerSellingUnit:string};
/** Matches the saved invoice policy: tax on line-discounted subtotal, then
 * invoice-wide discount reduces revenue. Reject historical rounding mismatches. */
export function allocateOriginalInvoiceLines(input:{subtotal:string;discountAmount:string;tax:string;total:string;lines:OriginalLine[]}){
 const subtotal=moneyCents(input.subtotal),discount=moneyCents(input.discountAmount),tax=moneyCents(input.tax),total=moneyCents(input.total);
 const applied=discount<subtotal?discount:subtotal;
 if(!input.lines.length||subtotal<=0n||subtotal-applied+tax!==total)throw Error('Original invoice totals require reconciliation.');
 const weights=input.lines.map(l=>{
 if(!Number.isSafeInteger(l.quantity)||l.quantity<=0)throw Error('Invalid original invoice quantity.');
 const pct=moneyCents(l.discountPercent);
 if(pct>10000n)throw Error('Invalid historical discount.');
 const raw=moneyCents(l.sellingPrice)*BigInt(l.quantity)*(10000n-pct)-moneyCents(l.discountAmount)*10000n;
 return raw>0n?(raw+5000n)/10000n:0n;
 });
 if(weights.reduce((a,b)=>a+b,0n)!==subtotal)throw Error('Historical line discounts do not reconcile to invoice subtotal.');
 let cumulative=0n;
 return input.lines.map((l,index)=>{
 const before=cumulative;cumulative+=weights[index];
 const share=(value:bigint)=>value*cumulative/subtotal-value*before/subtotal;
 return {lineIndex:index,netRevenue:decimal(weights[index]-share(applied)),tax:decimal(share(tax)),inventoryCost:decimal(moneyCents(l.costPerSellingUnit)*BigInt(l.quantity))};
 });
}
