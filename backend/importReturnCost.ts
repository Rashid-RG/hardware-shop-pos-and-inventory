import {moneyCents} from './generalLedger';

type ReceiptCost={baseQuantity:number;landedCost:string};

/** Allocate historical receipt cost for audit only. Actual stock relief must use
 * current carrying cost; no freight/customs recovery is assumed by this helper. */
export function allocateImportReturnCost(input:{receipts:ReceiptCost[];previousReturnedBaseQuantity:number;returnBaseQuantity:number;goodsCostPerPurchaseUnit:string;purchaseFactor:number}){
 const {receipts,previousReturnedBaseQuantity:previous,returnBaseQuantity:quantity,purchaseFactor:factor}=input;
 if(!Array.isArray(receipts)||!receipts.length||![previous,quantity,factor].every(Number.isSafeInteger)||previous<0||quantity<=0||factor<=0)throw Error('Valid import return quantity and receipt history required.');
 let total=0n,landed=0n;
 for(const receipt of receipts){
 if(!Number.isSafeInteger(receipt.baseQuantity)||receipt.baseQuantity<=0)throw Error('Invalid import receipt cost history.');
 const cost=moneyCents(receipt.landedCost);
 if(cost<=0n)throw Error('Invalid import receipt cost history.');
 total+=BigInt(receipt.baseQuantity);landed+=cost;
 }
 const end=BigInt(previous)+BigInt(quantity);
 if(end>total||total%BigInt(factor)!==0n)throw Error('Import return exceeds verified receipt quantities or packaging reconciliation required.');
 const goods=moneyCents(input.goodsCostPerPurchaseUnit)*total/BigInt(factor);
 if(goods<=0n||landed<goods)throw Error('Import landed cost does not reconcile to goods cost.');
 // Cumulative rounding makes consecutive partial allocations conserve total cents.
 const allocate=(amount:bigint)=>amount*end/total-amount*BigInt(previous)/total;
 const goodsCost=allocate(goods),allocatedCharges=allocate(landed-goods);
 return {goodsCost,allocatedCharges,historicalLandedCost:goodsCost+allocatedCharges,receivedBaseQuantity:total};
}
