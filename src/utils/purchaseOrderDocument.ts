import type {PurchaseOrder} from '../types';
import type {BusinessReport} from './businessReport';
import {reportDay} from './reporting';

/** Export the saved order, not a receipt or a supplier payment statement. */
export function purchaseOrderDocument(po:PurchaseOrder,shopId:string):BusinessReport{
 if(!shopId||po.shopId!==shopId)throw Error('Purchase order does not belong to the active shop.');
 if(!po.poNumber||!po.items.length||!Number.isFinite(po.total)||po.total<0)throw Error('Invalid saved purchase order.');
 const rows=po.items.map((i,index)=>{
 if(!Number.isFinite(i.quantity)||i.quantity<=0||!Number.isFinite(i.costPrice)||i.costPrice<0)throw Error('Invalid purchase order line.');
 return [index+1,i.productName,i.sellingUnitLabel||'Not recorded',i.baseUnitsPerPurchaseUnit??'Not recorded',i.quantity,i.costPrice,Math.round(i.quantity*i.costPrice*100)/100];
 });
 return {title:'Purchase order '+po.poNumber,filename:'ars-po-'+po.poNumber.replace(/[^a-zA-Z0-9_-]/g,'-'),period:reportDay(po.date)+' | Supplier: '+po.supplierName+' | Status: '+po.status,headers:['Line','Product','Purchase U/M','Base units per U/M','Ordered qty','Unit cost (LKR)','Line amount (LKR)'],moneyColumns:[5,6],rows,summary:[{label:'Recorded order total (LKR)',value:po.total},{label:'Product lines',value:rows.length},{label:'Document status',value:po.status},{label:'Purpose',value:'Order only - not proof of receipt'}]};
}
