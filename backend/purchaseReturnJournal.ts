import {moneyCents,validateJournal,type JournalLine} from './generalLedger';
import {decimal} from './supplierAdvance';
export function validatePurchaseReturnQuantity(input:{quantity:number;unitsPerReturnUnit:number;receivedBaseQuantity:number;previousReturnedBaseQuantity:number;availableBaseQuantity:number}){
 const {quantity,unitsPerReturnUnit,receivedBaseQuantity,previousReturnedBaseQuantity,availableBaseQuantity}=input;
 if(![quantity,unitsPerReturnUnit,receivedBaseQuantity,previousReturnedBaseQuantity,availableBaseQuantity].every(Number.isSafeInteger)||quantity<=0||unitsPerReturnUnit<=0||receivedBaseQuantity<0||previousReturnedBaseQuantity<0||availableBaseQuantity<0)throw Error('Valid whole return quantities required.');
 const base=quantity*unitsPerReturnUnit;
 if(!Number.isSafeInteger(base)||base>receivedBaseQuantity-previousReturnedBaseQuantity||base>availableBaseQuantity)throw Error('Return exceeds received quantity or available stock.');
 return base;
}
/** Supplier credit is documented independently from current inventory carrying value.
 * Already paid portions become supplier advances, not a fictitious cash refund.
 */
export function buildPurchaseReturnJournal(input:{inventoryCost:string;supplierCredit:string;outstandingPayable:string;inventoryAccount:string;payableAccount:string;advanceAccount:string;varianceAccount:string}):JournalLine[]{
 const cost=moneyCents(input.inventoryCost),credit=moneyCents(input.supplierCredit),payable=moneyCents(input.outstandingPayable);
 if(cost<=0n||credit<=0n)throw Error('Positive verified return costs required.');
 const applied=credit<payable?credit:payable,advance=credit-applied,variance=cost-credit;
 const lines:JournalLine[]=[{accountCode:input.inventoryAccount,debit:'0.00',credit:decimal(cost)}];
 if(applied>0n)lines.push({accountCode:input.payableAccount,debit:decimal(applied),credit:'0.00'});
 if(advance>0n)lines.push({accountCode:input.advanceAccount,debit:decimal(advance),credit:'0.00'});
 if(variance!==0n)lines.push({accountCode:input.varianceAccount,debit:decimal(variance>0n?variance:0n),credit:decimal(variance<0n?-variance:0n)});
 if(new Set(lines.map(l=>l.accountCode)).size!==lines.length)throw Error('Distinct return accounts required.');
 validateJournal(lines);return lines;
}
