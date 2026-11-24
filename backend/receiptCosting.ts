/** Monetary allocation uses integer cents, never a rounded unit rate multiplied by quantity. */
function cents(value:number){
 if(!Number.isFinite(value)||value<0||value>9999999999.99||Math.abs(value*100-Math.round(value*100))>0.001)throw Error('Invalid inventory cost.');
 return BigInt(Math.round(value*100));
}
function units(value:number){
 if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid inventory quantity.');
 return BigInt(value);
}
export function allocateReceiptCost(input:{landedTotal:number;orderedQuantity:number;previouslyReceived:number;receivingQuantity:number}){
 const total=cents(input.landedTotal),ordered=units(input.orderedQuantity),prior=units(input.previouslyReceived),received=units(input.receivingQuantity);
 if(ordered===0n||received===0n||prior+received>ordered)throw Error('Invalid partial receipt cost quantities.');
 // Cumulative floor allocation ensures every partial delivery reconciles to the approved line total.
 const amount=total*(prior+received)/ordered-total*prior/ordered;
 return Number(amount)/100;
}
export function weightedAverageReceiptCost(input:{existingQuantity:number;existingUnitCost:number;receivedBaseQuantity:number;receivedTotalCost:number}){
 const existing=units(input.existingQuantity),received=units(input.receivedBaseQuantity);
 const oldCost=cents(input.existingUnitCost),receivedCost=cents(input.receivedTotalCost);
 if(received===0n||receivedCost===0n||(existing>0n&&oldCost===0n))throw Error('Verified existing and incoming inventory costs are required.');
 const quantity=existing+received,total=existing*oldCost+receivedCost;
 const rounded=(total+quantity/2n)/quantity;
 const cost=Number(rounded)/100;
 cents(cost);
 return {quantity:Number(quantity),unitCost:cost,receivedTotalCost:input.receivedTotalCost,roundingDifference:Number(quantity*rounded-total)/100};
}
