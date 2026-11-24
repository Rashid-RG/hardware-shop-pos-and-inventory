import DisbursementVoucherActions from './DisbursementVoucherActions';
import { reportDay } from '../utils/reporting';
import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';
import React, { useState, useEffect, useRef } from 'react';
import { notify } from '../utils/notifications';
import {
  Truck,
  Plus,
  Search,
  Users,
  ShoppingCart,
  Calendar,
  AlertCircle,
  FileText,
  CheckCircle,
  Check,
  X,
  CreditCard,
  Building,
  Wallet,
} from 'lucide-react';
import { Supplier, PurchaseOrder, Product, Role, SupplierPayment } from '../types';

type SupplierPaymentRequest={supplierId:string;supplierName:string;purchaseOrderId?:string;amount:number;paymentMethod:string;date:string;note?:string;sourceAccountId?:string;requestId?:string};
type SourceAccount={id:string;name:string;kind:string;active:boolean;balance:number};
interface SupplierPurchaseViewProps {
  financialAuthToken?:string;
  financialShopId?:string;
  financialOwner?:string;
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  supplierPayments: SupplierPayment[];
  products: Product[];
  currentRole: Role;
  currentUser: string;
  taxConfig?: { taxRate: number; storeName: string; currency: string; invoicePrefix: string };
  onAddSupplier: (supData: Omit<Supplier, 'id'>) => Promise<void>;
  onCreatePO: (poData: { supplierId: string; supplierName: string; items: any[]; orderUser: string }) => Promise<void>;
  onReceivePO: (poId: string, receiveUser: string) => Promise<void>;
  onAddSupplierPayment: (payload: SupplierPaymentRequest) => Promise<void>;
}

export default function SupplierPurchaseView({
  suppliers,
  purchaseOrders,
  supplierPayments,
  products,
  currentRole,
  currentUser,
  taxConfig,
  onAddSupplier,
  onCreatePO,
  onReceivePO,
  onAddSupplierPayment,
  financialAuthToken,financialShopId,financialOwner,
}: SupplierPurchaseViewProps) {
  const [returnHistoryOrder,setReturnHistoryOrder]=useState<PurchaseOrder|null>(null);
  const [returnHistory,setReturnHistory]=useState<Array<{id:string;return_date:string;reason:string;evidence:string;recorded_by:string;items:Array<{itemId:number;baseQuantity:number;inventoryCost:string;supplierCredit:string}>}>>([]);
  const [returnHistoryError,setReturnHistoryError]=useState('');
  const [returnHistoryLoading,setReturnHistoryLoading]=useState(false);
  const canViewReturns=!!financialAuthToken&&!!financialShopId&&['Super Admin','Store Manager'].includes(currentRole);
  useEffect(()=>{setReturnHistoryOrder(null);setReturnHistory([]);setReturnHistoryError('');},[financialShopId,financialAuthToken,currentRole]);
  useEffect(()=>{
    if(!returnHistoryOrder||!canViewReturns)return;
    const controller=new AbortController();
    setReturnHistory([]);setReturnHistoryError('');setReturnHistoryLoading(true);
    fetch('/api/ledger/purchase-returns/'+encodeURIComponent(returnHistoryOrder.id),{headers:{Authorization:'Bearer '+financialAuthToken,'X-Shop-Id':financialShopId||''},cache:'no-store',signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok||!Array.isArray(data))throw Error(data.error||'Unable to load purchase returns.');if(!controller.signal.aborted)setReturnHistory(data);})
      .catch(error=>{if(!controller.signal.aborted)setReturnHistoryError(error instanceof Error?error.message:'Unable to load purchase returns.');})
      .finally(()=>{if(!controller.signal.aborted)setReturnHistoryLoading(false);});
    return ()=>controller.abort();
  },[returnHistoryOrder,canViewReturns,financialAuthToken,financialShopId]);
  type ReturnCandidate={itemId:number;productName:string;availableBaseQuantity:number;receivedBaseQuantity:number;returnedBaseQuantity:number;purchaseCost:string;purchaseFactor:number;units:Array<{id:string;label:string;baseUnits:number}>};
  type ReturnRequest={requestId:string;poId:string;date:string;reason:string;evidence:string;items:Array<{itemId:number;baseQuantity:number;supplierCredit:string}>};
  const canPostReturn=canViewReturns&&currentRole==='Super Admin'&&!!financialOwner;
  const returnKey='ars:pending-purchase-return:'+JSON.stringify([financialOwner||'',financialShopId||'']);
  const [returnOrder,setReturnOrder]=useState<PurchaseOrder|null>(null);
  const [returnDate,setReturnDate]=useState(reportDay(new Date()));
  const [returnReason,setReturnReason]=useState('');
  const [returnEvidence,setReturnEvidence]=useState('');
  const [returnCandidates,setReturnCandidates]=useState<ReturnCandidate[]>([]);
  const [returnDraft,setReturnDraft]=useState<Record<number,{unit:string;quantity:string;credit:string}>>({});
  const [returnError,setReturnError]=useState('');
  const [returnLoading,setReturnLoading]=useState(false);
  const [returnBusy,setReturnBusy]=useState(false);
  const [returnSaved,setReturnSaved]=useState<ReturnRequest|null>(null);
  const [returnStorageReady,setReturnStorageReady]=useState(false);
  const returnLock=useRef(false);
  useEffect(()=>{
    setReturnOrder(null);setReturnSaved(null);setReturnStorageReady(false);setReturnError('');
    if(!canPostReturn)return;
    try{setReturnSaved(JSON.parse(localStorage.getItem(returnKey)||'null'));setReturnStorageReady(true);}
    catch{setReturnError('Cannot read saved return request. Check browser storage.');}
  },[returnKey,canPostReturn,financialAuthToken]);
  useEffect(()=>{
    setReturnCandidates([]);setReturnDraft({});
    if(!returnOrder||!canPostReturn)return;
    const controller=new AbortController();setReturnLoading(true);setReturnError('');
    fetch('/api/ledger/purchase-returns/'+encodeURIComponent(returnOrder.id)+'/candidates?date='+encodeURIComponent(returnDate),{headers:{Authorization:'Bearer '+financialAuthToken,'X-Shop-Id':financialShopId||''},cache:'no-store',signal:controller.signal})
      .then(async response=>{const data=await response.json();if(!response.ok||!Array.isArray(data.items))throw Error(data.error||'Unable to load eligible products.');if(!controller.signal.aborted)setReturnCandidates(data.items);})
      .catch(error=>{if(!controller.signal.aborted)setReturnError(error instanceof Error?error.message:'Unable to load products.');})
      .finally(()=>{if(!controller.signal.aborted)setReturnLoading(false);});
    return ()=>controller.abort();
  },[returnOrder,returnDate,canPostReturn,financialAuthToken,financialShopId]);
  const draftFor=(line:ReturnCandidate)=>returnDraft[line.itemId]||{unit:line.units[0]?.id||'',quantity:'',credit:''};
  const changeReturnLine=(line:ReturnCandidate,patch:Partial<{unit:string;quantity:string;credit:string}>)=>setReturnDraft(previous=>({...previous,[line.itemId]:{...(previous[line.itemId]||{unit:line.units[0]?.id||'',quantity:'',credit:''}),...patch}}));
  const baseQuantity=(line:ReturnCandidate)=>Number(draftFor(line).quantity)*(line.units.find(unit=>unit.id===draftFor(line).unit)?.baseUnits||0);
  async function postSavedReturn(request:ReturnRequest){
    if(returnLock.current||!canPostReturn||!returnStorageReady)return;
    returnLock.current=true;setReturnBusy(true);setReturnError('');
    try{
      const response=await fetch('/api/ledger/purchase-returns',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+financialAuthToken,'X-Shop-Id':financialShopId||''},body:JSON.stringify(request)});
      const result=await response.json();if(!response.ok||result.id!==request.requestId)throw Error(result.error||'Return not confirmed.');
      localStorage.removeItem(returnKey);setReturnSaved(null);setReturnOrder(null);setReturnDraft({});
      notify.success('Purchase return recorded. Reloading stock and supplier records.');
      window.location.reload();
    }catch(error){setReturnError((error instanceof Error?error.message:'Return not confirmed.')+' Saved request retained; retry the same request or ask an administrator to reconcile it.');}
    finally{returnLock.current=false;setReturnBusy(false);}
  }
  async function submitReturn(event:React.FormEvent){
    event.preventDefault();
    if(!returnOrder||returnSaved||returnLock.current||returnLoading||!returnStorageReady||!canPostReturn)return;
    const chosen=returnCandidates.filter(line=>draftFor(line).quantity!==''||draftFor(line).credit!=='');
    if(!chosen.length||!returnReason.trim()||!returnEvidence.trim()||chosen.some(line=>{const d=draftFor(line),qty=baseQuantity(line);return !Number.isSafeInteger(Number(d.quantity))||Number(d.quantity)<=0||!Number.isSafeInteger(qty)||qty<=0||qty>line.availableBaseQuantity||!/^\d{1,14}(\.\d{1,2})?$/.test(d.credit)||Number(d.credit)<=0;})){setReturnError('Enter valid quantities, supplier credits, reason and evidence.');return;}
    const request:ReturnRequest={requestId:crypto.randomUUID(),poId:returnOrder.id,date:returnDate,reason:returnReason.trim(),evidence:returnEvidence.trim(),items:chosen.map(line=>({itemId:line.itemId,baseQuantity:baseQuantity(line),supplierCredit:draftFor(line).credit}))};
    if(!window.confirm('Post this purchase return and deduct the selected stock?'))return;
    try{localStorage.setItem(returnKey,JSON.stringify(request));}catch{setReturnError('Cannot safely save return request. Nothing posted.');return;}
    setReturnSaved(request);await postSavedReturn(request);
  }
  type RefundRequest={requestId:string;returnId:string;accountId:string;amount:string;date:string;evidence:string};
  type RefundAvailability={returnId:string;returnDate:string;returnCredit:string;refunded:string;orderAdvance:string;available:string;accounts:Array<{id:string;name:string;kind:string}>};
  type RefundHistory={id:string;amount:string;refund_date:string;evidence:string;recorded_by:string;account_name:string|null;account_id:string};
  const refundKey='ars:pending-supplier-refund:'+JSON.stringify([financialOwner||'',financialShopId||'']);
  const [refundReturnId,setRefundReturnId]=useState('');
  const [refundAvailability,setRefundAvailability]=useState<RefundAvailability|null>(null);
  const [refundHistory,setRefundHistory]=useState<RefundHistory[]>([]);
  const [refundAmount,setRefundAmount]=useState('');
  const [refundAccount,setRefundAccount]=useState('');
  const [refundDate,setRefundDate]=useState(reportDay(new Date()));
  const [refundEvidence,setRefundEvidence]=useState('');
  const [refundSaved,setRefundSaved]=useState<RefundRequest|null>(null);
  const [refundStorageReady,setRefundStorageReady]=useState(false);
  const [refundLoading,setRefundLoading]=useState(false);
  const [refundBusy,setRefundBusy]=useState(false);
  const [refundError,setRefundError]=useState('');
  const [refundAvailabilityError,setRefundAvailabilityError]=useState('');
  const [refundVersion,setRefundVersion]=useState(0);
  const refundLock=useRef(false);
  useEffect(()=>{
    setRefundReturnId('');setRefundSaved(null);setRefundStorageReady(false);setRefundError('');
    if(!canPostReturn)return;
    try{const saved=JSON.parse(localStorage.getItem(refundKey)||'null') as RefundRequest|null;setRefundSaved(saved);if(saved)setRefundReturnId(saved.returnId);setRefundStorageReady(true);}
    catch{setRefundError('Cannot read saved refund request. Check browser storage.');}
  },[refundKey,canPostReturn,financialAuthToken]);
  useEffect(()=>{
    setRefundAvailability(null);setRefundHistory([]);setRefundAvailabilityError('');
    if(!refundReturnId||!canViewReturns)return;
    const controller=new AbortController();setRefundLoading(true);
    const url='/api/ledger/supplier-refunds/'+encodeURIComponent(refundReturnId);
    const load=async(path:string)=>{const response=await fetch(path,{headers:{Authorization:'Bearer '+financialAuthToken,'X-Shop-Id':financialShopId||''},cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load refund information.');return data;};
    Promise.allSettled([load(url),load(url+'/availability')]).then(([history,availability])=>{
      if(controller.signal.aborted)return;
      if(history.status==='fulfilled'&&Array.isArray(history.value))setRefundHistory(history.value);else setRefundError('Unable to load refund history.');
      if(availability.status==='fulfilled'&&availability.value.returnId===refundReturnId&&Array.isArray(availability.value.accounts))setRefundAvailability(availability.value);
      else setRefundAvailabilityError(availability.status==='rejected'&&availability.reason instanceof Error?availability.reason.message:'Unable to calculate refundable credit.');
    }).finally(()=>{if(!controller.signal.aborted)setRefundLoading(false);});
    return ()=>controller.abort();
  },[refundReturnId,canViewReturns,financialAuthToken,financialShopId,refundVersion]);
  const openRefund=(id:string)=>{setRefundReturnId(id);setRefundAvailability(null);setRefundLoading(true);setRefundError('');setRefundAmount('');setRefundAccount('');setRefundEvidence('');setRefundDate(reportDay(new Date()));setRefundVersion(v=>v+1);};
  async function postSavedRefund(request:RefundRequest){
    if(refundLock.current||!canPostReturn||!refundStorageReady)return;
    refundLock.current=true;setRefundBusy(true);setRefundError('');
    try{
      const response=await fetch('/api/ledger/supplier-refunds',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+financialAuthToken,'X-Shop-Id':financialShopId||''},body:JSON.stringify(request)});
      const result=await response.json();if(!response.ok||result.id!==request.requestId)throw Error(result.error||'Refund not confirmed.');
      localStorage.removeItem(refundKey);setRefundSaved(null);setRefundAmount('');setRefundEvidence('');setRefundAccount('');setRefundVersion(v=>v+1);notify.success('Supplier refund recorded.');
    }catch(error){setRefundError((error instanceof Error?error.message:'Refund not confirmed.')+' Saved request retained; retry this exact request or reconcile with an administrator.');}
    finally{refundLock.current=false;setRefundBusy(false);}
  }
  async function submitRefund(event:React.FormEvent){
    event.preventDefault();
    if(!canPostReturn||!refundStorageReady||refundSaved||refundLock.current||refundLoading||!refundAvailability||refundAvailability.returnId!==refundReturnId)return;
    const amount=Number(refundAmount);
    if(!/^\d{1,12}(\.\d{1,2})?$/.test(refundAmount)||!Number.isFinite(amount)||amount<=0||amount>Number(refundAvailability.available)||!refundAvailability.accounts.some(a=>a.id===refundAccount)||!refundEvidence.trim()||refundDate<refundAvailability.returnDate||refundDate>reportDay(new Date())){setRefundError('Enter a valid amount, destination, date and evidence.');return;}
    if(!window.confirm('Confirm money actually received from the supplier into the selected account?'))return;
    const request:RefundRequest={requestId:crypto.randomUUID(),returnId:refundReturnId,accountId:refundAccount,amount:refundAmount,date:refundDate,evidence:refundEvidence.trim()};
    try{localStorage.setItem(refundKey,JSON.stringify(request));}catch{setRefundError('Cannot safely save refund request. Nothing posted.');return;}
    setRefundSaved(request);await postSavedRefund(request);
  }
  const currencySymbol = 'Rs.';
  const [activeTab, setActiveTab] = useState<'purchases' | 'suppliers'>('purchases');

  // Supplier forms
  const [isSupOpen, setIsSupOpen] = useState(false);
  const [supName, setSupName] = useState('');
  const [supCompany, setSupCompany] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supTax, setSupTax] = useState('');
  const [isSupSubmitting, setIsSupSubmitting] = useState(false);

  // New PO Composer details
  const [isPOOpen, setIsPOOpen] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poItems, setPoItems] = useState<PurchaseOrder['items']>([]);
  const [selectedAddProductId, setSelectedAddProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [sellingUnitId, setSellingUnitId] = useState('');
  const selectedProduct = products.find(product => product.id === selectedAddProductId);
  const [addQty, setAddQty] = useState(20);
  const [addCost, setAddCost] = useState(5.0);
  const [isPOSubmitting, setIsPOSubmitting] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<{ supplierId: string; supplierName: string; purchaseOrderId?: string } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer');
  const [paymentDate, setPaymentDate] = useState(reportDay(new Date()));
  const [paymentNote, setPaymentNote] = useState('');
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [sources,setSources]=useState<SourceAccount[]>([]);
  const [sourceId,setSourceId]=useState('');
  const [sourceError,setSourceError]=useState('');
  const [sourceLoading,setSourceLoading]=useState(false);
  const [pendingPayment,setPendingPayment]=useState<SupplierPaymentRequest|null>(null);
  const [storageReady,setStorageReady]=useState(false);
  const paymentLock=useRef(false);
  const financialEnabled=!!financialAuthToken&&!!financialShopId&&!!financialOwner&&['Super Admin','Store Manager'].includes(currentRole);
  const paymentStorageKey='ars:pending-supplier-payment:'+JSON.stringify([financialOwner||'',financialShopId||'']);
  const compatibleSources=sources.filter(a=>a.active&&(paymentMethod==='Cash'?a.kind==='Office Cash':paymentMethod==='Bank Transfer'?a.kind==='Bank':false));
  useEffect(()=>{
    setPendingPayment(null);setStorageReady(false);setPaymentDraft(null);
    if(!financialEnabled)return;
    try{setPendingPayment(JSON.parse(localStorage.getItem(paymentStorageKey)||'null'));setStorageReady(true);}
    catch{setSourceError('Cannot read saved supplier payment. Check browser storage.');}
  },[paymentStorageKey,financialEnabled]);
  useEffect(()=>{
    setSources([]);setSourceId('');setSourceError('');
    if(!paymentDraft||!financialEnabled)return;
    const controller=new AbortController();setSourceLoading(true);
    fetch('/api/financial-accounts',{headers:{Authorization:'Bearer '+financialAuthToken,'X-Shop-Id':financialShopId||''},cache:'no-store',signal:controller.signal})
      .then(async r=>{const data=await r.json();if(!r.ok||!Array.isArray(data))throw Error(data.error||'Unable to load payment accounts.');return data;})
      .then(data=>{if(!controller.signal.aborted)setSources(data);}).catch(e=>{if(!controller.signal.aborted)setSourceError(e.message);}).finally(()=>{if(!controller.signal.aborted)setSourceLoading(false);});
    return ()=>controller.abort();
  },[paymentDraft?.supplierId,paymentDraft?.purchaseOrderId,financialAuthToken,financialShopId,financialEnabled]);

  // Search parameters
  const [searchTerm, setSearchTerm] = useState('');
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [visiblePurchaseCount, setVisiblePurchaseCount] = useState(12);
  const [visibleSupplierCount, setVisibleSupplierCount] = useState(12);

  // Suppliers validation
  const canModify = ['Super Admin', 'Store Manager', 'Inventory Staff'].includes(currentRole);

  const handleSubmitSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim() || !supCompany.trim()) {
      notify.warning('Please fill out Name and Company fields');
      return;
    }
    setIsSupSubmitting(true);
    try {
      await onAddSupplier({
        name: supName,
        companyName: supCompany,
        phone: supPhone,
        email: supEmail,
        address: supAddress,
        taxNumber: supTax,
      });
      notify.success('Supplier registered successfully.');
      setIsSupOpen(false);
      setSupName('');
      setSupCompany('');
      setSupPhone('');
      setSupEmail('');
      setSupAddress('');
      setSupTax('');
    } catch (err) {
      notify.error('Failed to register supplier: ' + err);
    } finally {
      setIsSupSubmitting(false);
    }
  };

  // PO Line Composer helpers
  const handleAddItemLine = () => {
    if (!selectedAddProductId) {
      notify.warning('Select a product to add to the line first');
      return;
    }
    const product = products.find((p) => p.id === selectedAddProductId);
    if (!product) return;

    const unit = product.sharedStockUnits?.units.find(item=>item.id===sellingUnitId);
    if (product.sharedStockUnits && (!unit || product.variants?.length)) return notify.warning('Choose a valid purchasing U/M.');
    const variant = product.variants?.find(item => item.id === variantId);
    if (product.variants?.length && !variant) return notify.warning('Choose the size or variant to receive.');
    if (!Number.isSafeInteger(addQty) || addQty <= 0 || !Number.isFinite(addCost) || addCost < 0) {
      return notify.warning('Enter a positive whole quantity and a valid unit cost.');
    }
    const existingIndex = poItems.findIndex((it) => it.productId === selectedAddProductId && it.variantId === variant?.id && it.sellingUnitId === unit?.id && it.costPrice === addCost);
    if (existingIndex !== -1) {
      const updated = [...poItems];
      updated[existingIndex].quantity += addQty;
      setPoItems(updated);
    } else {
      setPoItems([
        ...poItems,
        {
          productId: selectedAddProductId,
          productName: variant ? product.name + " (" + variant.name + ")" : product.name,
          variantId: variant?.id,
          sellingUnitId: unit?.id,
          sellingUnitLabel: unit?.label,
          baseUnitsPerPurchaseUnit: unit?.baseUnits,
          quantity: addQty,
          costPrice: addCost,
        },
      ]);
    }
    setSelectedAddProductId('');
  };

  const handleRemoveLine = (idx: number) => {
    setPoItems(poItems.filter((_, i) => i !== idx));
  };

  const handleCreatePurchaseRequest = async () => {
    if (!poSupplierId) {
      notify.warning('Please designate concrete Supplier target.');
      return;
    }
    if (poItems.length === 0) {
      notify.warning('Must populate at least one catalog item line draft.');
      return;
    }
    setIsPOSubmitting(true);

    const matchSup = suppliers.find((s) => s.id === poSupplierId);
    if (!matchSup) return;

    try {
      await onCreatePO({
        supplierId: poSupplierId,
        supplierName: matchSup.name,
        items: poItems,
        orderUser: currentUser,
      });
      notify.success('Purchase order created successfully.');
      setIsPOOpen(false);
      setPoSupplierId('');
      setPoItems([]);
    } catch (err) {
      notify.error('Failed to create purchase order: ' + err);
    } finally {
      setIsPOSubmitting(false);
    }
  };

  // Filter supplier listings
  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getSupplierPayments = (supplierId: string) =>
    supplierPayments
      .filter((payment) => payment.supplierId === supplierId)
      .sort((a, b) => b.date.localeCompare(a.date));

  const getSupplierStats = (supplierId: string) => {
    const relatedPOs = purchaseOrders.filter((po) => po.supplierId === supplierId);
    const orderedTotal = relatedPOs.reduce((sum, po) => sum + po.total, 0);
    const paidTotal = supplierPayments
      .filter((payment) => payment.supplierId === supplierId)
      .reduce((sum, payment) => sum + payment.amount, 0);
    return {
      orderedTotal,
      paidTotal,
      outstanding: Math.max(0, orderedTotal - paidTotal),
    };
  };

  const openPaymentModal = (supplierId: string, supplierName: string, purchaseOrderId?: string) => {
    setPaymentDraft({ supplierId, supplierName, purchaseOrderId });
    setPaymentAmount('');
    setPaymentMethod('Bank Transfer');
    setPaymentDate(reportDay(new Date()));
    setPaymentNote('');
  };

  async function submitSavedSupplierPayment(request:SupplierPaymentRequest){
    if(paymentLock.current)return;
    paymentLock.current=true;setIsPaymentSubmitting(true);setSourceError('');
    try{
      await onAddSupplierPayment(request);
      if(request.sourceAccountId)localStorage.removeItem(paymentStorageKey);
      setPendingPayment(null);setPaymentDraft(null);notify.success('Supplier payment recorded.');
    }catch(err){setSourceError(err instanceof Error?err.message:'Unable to confirm payment.');notify.error('Payment not confirmed. Review the saved request before retrying.');}
    finally{paymentLock.current=false;setIsPaymentSubmitting(false);}
  }
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentDraft || paymentLock.current || pendingPayment) return;
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      notify.warning('Enter a valid payment amount.');
      return;
    }
    if(financialEnabled&&(!storageReady||!compatibleSources.some(a=>a.id===sourceId&&a.balance>=amount))){
      notify.warning('Select a matching account with sufficient recorded funds.');return;
    }
    const request:SupplierPaymentRequest={
        supplierId: paymentDraft.supplierId,
        supplierName: paymentDraft.supplierName,
        purchaseOrderId: paymentDraft.purchaseOrderId,
        amount,
        paymentMethod,
        date: paymentDate,
        note: paymentNote || undefined,
        sourceAccountId:financialEnabled?sourceId:undefined,
        requestId:financialEnabled?crypto.randomUUID():undefined,
    };
    if(financialEnabled){
      try{localStorage.setItem(paymentStorageKey,JSON.stringify(request));}catch{notify.error('Cannot safely preserve payment request.');return;}
      setPendingPayment(request);
    }
    await submitSavedSupplierPayment(request);
  };

  const visiblePurchaseOrders=purchaseOrders.filter(po=>[po.poNumber,po.supplierName,po.status]
    .some(value=>String(value||'').toLowerCase().includes(purchaseSearch.trim().toLowerCase())));
  const procurementReport = ():BusinessReport => activeTab==='suppliers' ? {
 title:'Supplier directory',filename:'ars-suppliers',period:'Matching suppliers',headers:['Supplier','Company','Phone','Email','Address','Ordered excluding cancelled (LKR)','Payments (LKR)'],moneyColumns:[5,6],
 rows:filteredSuppliers.map(s=>[s.name,s.companyName,s.phone,s.email,s.address,purchaseOrders.filter(p=>p.supplierId===s.id&&p.status!=='Cancelled').reduce((a,p)=>a+p.total,0),supplierPayments.filter(p=>p.supplierId===s.id).reduce((a,p)=>a+p.amount,0)]),summary:[{label:'Matching suppliers',value:filteredSuppliers.length}]
 } : {title:'Purchase order register',filename:'ars-purchase-orders',period:'Matching purchase orders',headers:['Order','Date','Supplier','Lines','Amount (LKR)','Status'],moneyColumns:[4],rows:visiblePurchaseOrders.map(p=>[p.poNumber,reportDay(p.date),p.supplierName,p.items.length,p.total,p.status]),summary:[{label:'Orders',value:visiblePurchaseOrders.length},{label:'Non-cancelled order value (LKR)',value:visiblePurchaseOrders.filter(p=>p.status!=='Cancelled').reduce((a,p)=>a+p.total,0)}]};
  return (
    <div className="space-y-3 motion-safe:animate-fade-in font-sans selection:bg-amber-100">
      {/* View Header with Toggle navigation tabs */}
      <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-100 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-heading font-medium tracking-tight text-slate-900">
            Procurement & Wholesalers Hub
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Log supplier coordinates and create restock purchase requests securely.
          </p>
        </div>

        <div className="flex bg-slate-100 p-1.5 rounded-lg border border-slate-200">
          <button
            onClick={() => {
              setActiveTab('purchases');
              setSearchTerm('');
            }}
            className={`px-4 py-1.5 rounded text-xs font-semibold font-sans transition-all ${
              activeTab === 'purchases' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Purchase Orders
          </button>
          <button
            onClick={() => {
              setActiveTab('suppliers');
              setSearchTerm('');
            }}
            className={`px-4 py-1.5 rounded text-xs font-semibold font-sans transition-all ${
              activeTab === 'suppliers' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Wholesaler Directory
          </button>
        </div>
      </div>

      {canPostReturn&&(returnOrder||returnSaved||returnError)&&<section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" aria-label="Purchase return">
        <div className="flex justify-between"><div><h3 className="font-semibold">Record purchase return</h3><p className="text-xs text-slate-600">{returnOrder?.poNumber||returnSaved?.poId} · {returnOrder?.supplierName}</p></div>{!returnSaved&&<button type="button" onClick={()=>{setReturnOrder(null);setReturnError('');}} className="text-sm underline">Close</button>}</div>
        {returnError&&<p role="alert" className="text-sm text-red-700">{returnError}</p>}
        {returnSaved?<div className="space-y-2"><p className="text-sm">Saved request: {returnSaved.requestId}. {returnSaved.items.length} lines. Retry only this request to avoid duplicate stock deductions.</p><button type="button" disabled={returnBusy||!returnStorageReady} onClick={()=>void postSavedReturn(returnSaved)} className="rounded bg-slate-900 text-white px-3 py-2 disabled:opacity-50">{returnBusy?'Submitting…':'Retry saved return'}</button></div>:returnOrder&&<form onSubmit={submitReturn} className="space-y-3">
          <label className="block text-sm">Return date<input type="date" required max={reportDay(new Date())} value={returnDate} onChange={e=>setReturnDate(e.target.value)} className="block rounded border p-2"/></label>
          {returnLoading?<p role="status">Loading eligible products…</p>:returnCandidates.map(line=>{const d=draftFor(line);return <fieldset key={line.itemId} disabled={line.availableBaseQuantity<=0||!line.units.length} className="rounded-lg border p-3 disabled:opacity-50">
            <legend className="font-semibold text-sm">{line.productName} · line {line.itemId}</legend><p className="text-xs text-slate-600">Received: {line.receivedBaseQuantity} · Returned: {line.returnedBaseQuantity} · Available: {line.availableBaseQuantity} base units. Original purchase cost: Rs. {line.purchaseCost} per {line.purchaseUnit||'unit'}.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
              <label className="text-xs">U/M<select value={d.unit} onChange={e=>changeReturnLine(line,{unit:e.target.value})} className="block w-full rounded border p-2">{line.units.map(u=><option key={u.id} value={u.id}>{u.label} ({u.baseUnits} base units)</option>)}</select></label>
              <label className="text-xs">Quantity<input type="number" min="1" step="1" value={d.quantity} onChange={e=>changeReturnLine(line,{quantity:e.target.value})} className="block w-full rounded border p-2"/></label>
              <label className="text-xs">Supplier credit (LKR)<input inputMode="decimal" value={d.credit} onChange={e=>changeReturnLine(line,{credit:e.target.value})} className="block w-full rounded border p-2"/></label>
            </div><p className="text-xs mt-2">Stock deduction: {baseQuantity(line)||0} base units</p>
          </fieldset>;})}
          <label className="block text-sm">Return reason<input required maxLength={500} value={returnReason} onChange={e=>setReturnReason(e.target.value)} className="block w-full rounded border p-2"/></label>
          <label className="block text-sm">Evidence / supplier credit note reference<input required maxLength={500} value={returnEvidence} onChange={e=>setReturnEvidence(e.target.value)} className="block w-full rounded border p-2"/></label>
          <p className="text-xs text-slate-600">Supplier credit only; this does not record a cash or bank refund.</p>
          <button disabled={returnLoading||returnBusy||!returnStorageReady||!returnCandidates.length} className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50">Confirm purchase return</button>
        </form>}
      </section>}
      {canViewReturns&&(refundReturnId||refundSaved||refundError)&&<section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" aria-label="Supplier refund">
        <div className="flex justify-between gap-2"><div><h3 className="font-semibold">Supplier refunds</h3><p className="text-xs text-slate-600">Purchase return {refundReturnId||refundSaved?.returnId}</p></div>{!refundSaved&&<button type="button" onClick={()=>{setRefundReturnId('');setRefundError('');}} className="text-sm underline">Close</button>}</div>
        {refundError&&<p role="alert" className="text-sm text-red-700">{refundError}</p>}
        {refundSaved&&canPostReturn?<div className="space-y-2"><p className="text-sm">Unconfirmed saved refund {refundSaved.requestId} · Rs. {refundSaved.amount}. Retry the same request only.</p><button type="button" disabled={refundBusy||!refundStorageReady} onClick={()=>void postSavedRefund(refundSaved)} className="rounded bg-slate-900 text-white px-3 py-2 disabled:opacity-50">{refundBusy?'Submitting…':'Retry saved refund'}</button></div>:null}
        {refundLoading?<p role="status">Loading supplier refund information…</p>:<>
          {refundAvailabilityError&&<p role="alert" className="text-sm text-amber-800">{refundAvailabilityError}</p>}
          {refundAvailability&&<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">{[['Return advance credit',refundAvailability.returnCredit],['Refunded',refundAvailability.refunded],['Order advance',refundAvailability.orderAdvance],['Available refund',refundAvailability.available]].map(([label,value])=><div key={label} className="rounded border p-2"><p>{label}</p><p className="font-semibold">Rs. {value}</p></div>)}</div>}
          {canPostReturn&&!refundSaved&&refundAvailability&&Number(refundAvailability.available)>0&&<form onSubmit={submitRefund} className="space-y-2">
            <label className="block text-sm">Destination cash or bank account<select required value={refundAccount} onChange={e=>setRefundAccount(e.target.value)} className="block w-full rounded border p-2"><option value="">Select account</option>{refundAvailability.accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.kind}</option>)}</select></label>
            <label className="block text-sm">Refund amount (LKR)<input required inputMode="decimal" value={refundAmount} onChange={e=>setRefundAmount(e.target.value)} className="block w-full rounded border p-2"/></label>
            <label className="block text-sm">Received date<input required type="date" min={refundAvailability.returnDate} max={reportDay(new Date())} value={refundDate} onChange={e=>setRefundDate(e.target.value)} className="block rounded border p-2"/></label>
            <label className="block text-sm">Bank reference / cash receipt evidence<input required maxLength={500} value={refundEvidence} onChange={e=>setRefundEvidence(e.target.value)} className="block w-full rounded border p-2"/></label>
            <p className="text-xs text-slate-600">Record only money actually received. This does not move inventory.</p>
            <button disabled={refundBusy||!refundStorageReady||!refundAvailability.accounts.length} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Confirm supplier refund</button>
          </form>}
          <h4 className="text-sm font-semibold">Refund history</h4>
          {!refundHistory.length?<p className="text-xs text-slate-600">No refund records loaded.</p>:refundHistory.map(f=><div key={f.id} className="rounded border p-2 text-xs"><p className="font-semibold">{f.refund_date} · Rs. {f.amount} · {f.account_name||f.account_id}</p><p>{f.evidence} · {f.recorded_by}</p>{financialAuthToken&&financialShopId&&<DisbursementVoucherActions kind="supplier-refund" id={f.id} authToken={financialAuthToken} shopId={financialShopId}/>}</div>)}
        </>}
      </section>}
      {canViewReturns&&returnHistoryOrder&&<section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" aria-label="Purchase return history">
        <div className="flex justify-between gap-3"><div><h3 className="font-semibold">Purchase return history</h3><p className="text-xs text-slate-600">{returnHistoryOrder.poNumber} · {returnHistoryOrder.supplierName}</p></div><button type="button" className="text-sm underline" onClick={()=>setReturnHistoryOrder(null)}>Close history</button></div>
        {returnHistoryLoading?<p role="status">Loading returns…</p>:returnHistoryError?<p role="alert" className="text-red-700">{returnHistoryError}</p>:returnHistory.length===0?<p className="text-sm text-slate-500">No recorded purchase returns.</p>:returnHistory.map(entry=><article key={entry.id} className="rounded-lg border p-3 text-sm space-y-1">
          <p className="font-semibold">{entry.return_date} · {entry.id}</p><p>{entry.reason}</p><p>Evidence: {entry.evidence}</p><p>Recorded by: {entry.recorded_by}</p><button type="button" disabled={!!refundSaved||refundBusy} onClick={()=>openRefund(entry.id)} className="rounded border px-3 py-2 text-xs font-semibold disabled:opacity-50">View / record supplier refunds</button>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>PO line ID</th><th>Base units returned</th><th>Inventory cost (LKR)</th><th>Supplier credit (LKR)</th></tr></thead><tbody>{entry.items.map(line=><tr key={line.itemId}><td>{line.itemId}</td><td>{line.baseQuantity}</td><td>{line.inventoryCost}</td><td>{line.supplierCredit}</td></tr>)}</tbody></table></div>
        </article>)}
      </section>}
      {taxConfig && <ReportExportMenu report={procurementReport} settings={taxConfig}/>}
      {/* RENDER TAB 1: PURCHASE ORDER RECORDS */}
      {activeTab === 'purchases' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 rounded-xl border border-slate-100 shadow-2xs">
            <label className="flex-1 min-w-44">
              <span className="sr-only">Find purchase orders</span>
              <input type="search" aria-label="Find purchase orders" value={purchaseSearch}
                onChange={event=>{setPurchaseSearch(event.target.value);setVisiblePurchaseCount(12);}}
                placeholder="Find PO, supplier or status..." className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"/>
            </label>
            <span className="text-xs font-mono font-medium text-slate-500 uppercase">
              {purchaseOrders.length} Procurement Tracks Logged
            </span>
            {canModify && (
              <button
                id="btn-trigger-po-create"
                onClick={() => {
                  setPoItems([]);
                  setIsPOOpen(true);
                }}
                className="bg-slate-900 hover:bg-slate-950 text-slate-100 text-xs font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 shadow-xs transition"
              >
                <Plus className="w-4 h-4" /> Draft Purchase Order
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visiblePurchaseOrders.slice(0,visiblePurchaseCount).map((po) => {
              const totalItems = po.items.reduce((acc, i) => acc + i.quantity, 0);
              const isReceived = po.status === 'Received';
              const paidForPo = supplierPayments
                .filter((payment) => payment.purchaseOrderId === po.id)
                .reduce((sum, payment) => sum + payment.amount, 0);
              const outstandingForPo = Math.max(0, po.total - paidForPo);

              return (
                <div
                  key={po.id}
                  id={`po-card-${po.id}`}
                  className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs hover:shadow-xs transition duration-150 flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono font-semibold text-slate-400 block tracking-wider uppercase">
                        Procurement Request
                      </span>
                      <h4 className="font-mono text-sm font-black text-amber-600 mt-1">{po.poNumber}</h4>
                      <p className="text-xs font-semibold text-slate-900 mt-1.5 flex items-center gap-1.5">
                        <Building className="w-4 h-4 text-slate-400" /> {po.supplierName}
                      </p>
                    </div>

                    <span
                      className={`px-3 py-1 text-[9px] font-mono font-bold uppercase rounded-full border ${
                        isReceived
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-250'
                          : po.status === 'Ordered'
                          ? 'bg-blue-50 text-blue-800 border-blue-250'
                          : 'bg-amber-50 text-amber-850 border-amber-250'
                      }`}
                    >
                      {po.status}
                    </span>
                  </div>

                  {/* PO details list */}
                  <details className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-[11px]">
                    <summary className="cursor-pointer font-semibold text-slate-700">{po.items.length} product lines · view PO details</summary>
                    <div className="mt-2 grid grid-cols-3 text-slate-500 font-medium">
                      <span className="col-span-2">Target Product Unit</span>
                      <span className="text-right">Qty @ Cost</span>
                    </div>
                    {po.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between font-mono">
                        <span className="text-slate-800 truncate max-w-[200px]">{it.productName}</span>
                        <span className="text-slate-600 shrink-0 select-all">
                          {it.quantity} {it.sellingUnitLabel || 'units'} x {currencySymbol}{it.costPrice.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </details>

                  {canViewReturns&&['Received','Partially Received'].includes(po.status)&&<button type="button" className="self-start rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700" onClick={()=>{setReturnHistory([]);setReturnHistoryError('');setReturnHistoryLoading(true);setReturnHistoryOrder(po);}}>Purchase return history</button>}

                  {canPostReturn&&['Received','Partially Received'].includes(po.status)&&<button type="button" disabled={!!returnSaved||!returnStorageReady||returnBusy} className="self-start rounded-lg bg-slate-900 text-white px-3 py-2 text-xs disabled:opacity-50" onClick={()=>{setReturnOrder(po);setReturnDate(reportDay(new Date()));setReturnReason('');setReturnEvidence('');setReturnDraft({});}}>Record purchase return</button>}
                  {/* receipt trigger */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="font-mono">
                      <span className="text-slate-400 block text-[9px]">Grand Estimate</span>
                      <span className="font-bold text-slate-950 text-sm">{currencySymbol}{po.total.toFixed(2)}</span>
                      <span className="text-[10px] text-slate-500 block mt-1">
                        Paid: {currencySymbol}{paidForPo.toFixed(2)} | Due: <strong className={outstandingForPo > 0 ? 'text-rose-600' : 'text-emerald-600'}>{currencySymbol}{outstandingForPo.toFixed(2)}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openPaymentModal(po.supplierId, po.supplierName, po.id)}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 leading-none shadow-3xs transition"
                      >
                        <Wallet className="w-3.5 h-3.5" /> Record Payment
                      </button>
                      {(['Pending', 'Ordered', 'Partially Received'].includes(po.status)) && canModify ? (
                        <span className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-900">
                          Use Warehouse Receiving to record checked quantities
                        </span>
                      ) : isReceived ? (
                        <span className="text-emerald-600 font-semibold flex items-center gap-1 font-mono text-[10px]">
                          <CheckCircle className="w-4 h-4" /> REPLENISHED INTO SHELF
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px] font-mono leading-none">Draft Pending Staff check</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {visiblePurchaseOrders.length > visiblePurchaseCount && (
              <button type="button" onClick={()=>setVisiblePurchaseCount(value=>value+12)}
                className="col-span-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold">
                Show more purchase orders ({visiblePurchaseOrders.length-visiblePurchaseCount} remaining)
              </button>
            )}
            {visiblePurchaseOrders.length === 0 && (
              <div className="col-span-full py-16 text-center bg-white border border-dashed border-slate-200 rounded-xl text-slate-400">
                <ShoppingCart className="w-9 h-9 mx-auto opacity-40 text-slate-500" />
                <p className="text-xs font-semibold mt-2">Zero active purchase contracts logged</p>
                <p className="text-[10px] text-slate-500 mt-1">Initiate rests by creating restock plans with suppliers</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* RENDER TAB 2: SUPPLIERS DIRECTORY */}
      {activeTab === 'suppliers' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                id="supplier-search-input"
                type="text"
                placeholder="Search Wholesale Suppliers brand or tax ID..."
                value={searchTerm}
                onChange={(e) => {setSearchTerm(e.target.value);setVisibleSupplierCount(12);}}
                className="w-full pl-9 pr-4 py-1.5 bg-slate-50 text-slate-800 text-xs rounded-lg border border-slate-250 focus:outline-none focus:border-amber-500 font-sans"
              />
            </div>

            {canModify && (
              <button
                id="btn-register-supplier"
                onClick={() => setIsSupOpen(true)}
                className="bg-slate-900 hover:bg-slate-950 text-slate-100 text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 leading-none transition shadow-2xs"
              >
                <Plus className="w-4 h-4" /> Register Supplier Company
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredSuppliers.slice(0,visibleSupplierCount).map((sup) => (
              <div
                key={sup.id}
                id={`supplier-card-${sup.id}`}
                className="bg-white p-3 rounded-xl border border-slate-100 shadow-2xs flex flex-col justify-between hover:shadow-xs transition"
              >
                {(() => {
                  const stats = getSupplierStats(sup.id);
                  const recentPayments = getSupplierPayments(sup.id).slice(0, 3);
                  return (
                    <>
                <div>
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-amber-50 rounded-lg text-amber-500 h-9 w-9 flex items-center justify-center shrink-0">
                      <Building className="w-4 h-4 font-bold" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-sans font-bold text-slate-900 text-sm truncate">{sup.name}</h4>
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5 uppercase truncate">{sup.companyName}</p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-50 space-y-2 text-xs font-mono text-slate-600">
                    <p>Phone: <span className="text-slate-800 select-all font-semibold">{sup.phone}</span></p>
                    <p>Email: <span className="text-slate-800 select-all font-semibold truncate block">{sup.email}</span></p>
                    <p>Address: <span className="text-slate-800 font-sans text-[11px] truncate block">{sup.address}</span></p>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-[10px]">
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                      <p className="text-slate-400 uppercase font-semibold">Ordered</p>
                      <p className="font-mono font-bold text-slate-900 mt-1">{currencySymbol}{stats.orderedTotal.toFixed(0)}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2">
                      <p className="text-emerald-600 uppercase font-semibold">Paid</p>
                      <p className="font-mono font-bold text-emerald-700 mt-1">{currencySymbol}{stats.paidTotal.toFixed(0)}</p>
                    </div>
                    <div className="rounded-lg bg-rose-50 border border-rose-100 p-2">
                      <p className="text-rose-500 uppercase font-semibold">Due</p>
                      <p className="font-mono font-bold text-rose-600 mt-1">{currencySymbol}{stats.outstanding.toFixed(0)}</p>
                    </div>
                  </div>

                  {recentPayments.length > 0 && (
                    <details className="mt-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2">
                      <summary className="cursor-pointer text-[10px] uppercase font-semibold text-slate-500 mb-2">Recent Payments</summary>
                      <div className="space-y-1.5 text-[10px] font-mono">
                        {recentPayments.map((payment) => (
                          <div key={payment.id} className="flex items-center justify-between gap-2 text-slate-600">
                            <span>{payment.date} • {payment.paymentMethod}</span>
                            <strong className="text-emerald-700">{currencySymbol}{payment.amount.toFixed(2)}</strong>
                            {financialEnabled&&financialAuthToken&&financialShopId&&<DisbursementVoucherActions kind="supplier" id={payment.id} authToken={financialAuthToken} shopId={financialShopId} /> }
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                <div className="mt-4 pt-2.5 border-t border-slate-100/60 flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>TAX REG ID: <strong className="text-slate-850 font-bold">{sup.taxNumber || 'N/A'}</strong></span>
                  <button
                    onClick={() => openPaymentModal(sup.id, sup.name)}
                    className="text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1"
                  >
                    <Wallet className="w-3.5 h-3.5" /> Pay
                  </button>
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
            {filteredSuppliers.length > visibleSupplierCount && (
              <button type="button" onClick={()=>setVisibleSupplierCount(value=>value+12)}
                className="col-span-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold">
                Show more suppliers ({filteredSuppliers.length-visibleSupplierCount} remaining)
              </button>
            )}
          </div>
        </div>
      )}

      {pendingPayment&&<div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"><strong>Unconfirmed supplier payment</strong><p>{pendingPayment.supplierName} · Rs. {pendingPayment.amount.toFixed(2)} · {pendingPayment.date}</p><p>Retry the original request, not a new payment.</p>{sourceError&&<p role="alert">{sourceError}</p>}<button type="button" disabled={isPaymentSubmitting} className="rounded bg-slate-900 text-white px-3 py-2" onClick={()=>void submitSavedSupplierPayment(pendingPayment)}>Retry exact payment</button></div>}
      {paymentDraft && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-4 w-full max-w-sm border border-slate-250 font-sans relative max-h-[90dvh] overflow-y-auto">
            <button onClick={() => setPaymentDraft(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">Record Supplier Payment</h3>

            <form onSubmit={handleSubmitPayment} className="space-y-4 text-xs font-sans">
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-slate-700">
                <div className="font-semibold">{paymentDraft.supplierName}</div>
                {paymentDraft.purchaseOrderId ? <div className="text-[10px] font-mono text-slate-500 mt-1">PO Ref: {paymentDraft.purchaseOrderId}</div> : null}
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Amount *</label>
                <input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono" required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Method</label>
                  <select value={paymentMethod} onChange={(e) => {setPaymentMethod(e.target.value);setSourceId('');}} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500">
                    <option>Bank Transfer</option>
                    <option>Cash</option>
                    {!financialEnabled&&<><option>Cheque</option><option>Card</option></>}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Date</label>
                  <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono" />
                </div>
              </div>

              {financialEnabled&&<div><label className="block text-slate-500 font-semibold mb-1">Paid from *</label><select required value={sourceId} disabled={sourceLoading||isPaymentSubmitting} onChange={e=>setSourceId(e.target.value)} className="w-full rounded border p-2"><option value="">{sourceLoading?'Loading accounts…':'Select payment account'}</option>{compatibleSources.map(a=><option key={a.id} value={a.id}>{a.name} · Rs. {a.balance.toFixed(2)}</option>)}</select>{!sourceLoading&&!compatibleSources.length&&<p className="text-amber-800 mt-1">Create a matching financial account in Accounting first.</p>}</div>}
              {sourceError&&<p role="alert" className="text-red-700">{sourceError}</p>}
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Note</label>
                <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500" placeholder="Reference, bank slip, memo..." />
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button type="button" onClick={() => setPaymentDraft(null)} className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded">Cancel</button>
                <button type="submit" disabled={isPaymentSubmitting||!!pendingPayment||(financialEnabled&&(!storageReady||sourceLoading))} className="flex-1 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-3xs transition">
                  {isPaymentSubmitting ? 'Saving...' : 'Save Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG 1: ADD SUPPLIER MODAL */}
      {isSupOpen && (
        <div id="supplier-modal-backdrop" className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm border border-slate-250 font-sans relative">
            <button
              onClick={() => setIsSupOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">
              Register Wholesale Supplier Vendor
            </h3>

            <form onSubmit={handleSubmitSupplier} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Contract Name / Rep *</label>
                <input
                  id="input-sup-name"
                  type="text"
                  required
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  placeholder="e.g. Richard Hendricks (Tools Manager)"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Company Registered Legal Name *</label>
                <input
                  id="input-sup-company"
                  type="text"
                  required
                  value={supCompany}
                  onChange={(e) => setSupCompany(e.target.value)}
                  placeholder="e.g. Titan Hand Tools International"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Support Phone</label>
                  <input
                    id="input-sup-phone"
                    type="text"
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    placeholder="+1-555-4040"
                    className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Commerce Email</label>
                  <input
                    id="input-sup-email"
                    type="email"
                    value={supEmail}
                    onChange={(e) => setSupEmail(e.target.value)}
                    placeholder="orders@titanmfg.net"
                    className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Tax EIN Number</label>
                <input
                  id="input-sup-tax"
                  type="text"
                  value={supTax}
                  onChange={(e) => setSupTax(e.target.value)}
                  placeholder="TX-883901"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Corporate Headquarters Address</label>
                <input
                  id="input-sup-address"
                  type="text"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                  placeholder="220 Industry Parkway, Dallas, TX"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsSupOpen(false)}
                  className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  Cancel
                </button>
                <button
                  id="btn-submit-supplier"
                  type="submit"
                  disabled={isSupSubmitting}
                  className="flex-1 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-3xs transition"
                >
                  {isSupSubmitting ? 'Registering vendor...' : 'Register Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DIALOG 2: DYNAMIC PO COMPOSER MODAL */}
      {isPOOpen && (
        <div id="po-modal-backdrop" className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-45 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-slate-200 max-h-[90dvh] flex flex-col font-sans relative overflow-hidden">
            <button
              onClick={() => setIsPOOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="shrink-0 px-4 py-3 border-b border-slate-100 font-heading font-medium text-slate-900 text-lg flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-amber-500" /> Procurement Purchase Order Composer
            </h3>

            {/* Step 1: Supplier Selector */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3 text-xs font-sans">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Designated Wholesale Vendor *</label>
                <select
                  id="po-vendor-select"
                  value={poSupplierId}
                  onChange={(e) => setPoSupplierId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded text-xs focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Choose registered Supplier Vendor --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.companyName})
                    </option>
                  ))}
                </select>
              </div>

              {/* Step 2: Add lines tool */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-150 space-y-3.5">
                <p className="font-bold text-slate-900 text-[11px] uppercase tracking-wide">
                  Draft Restock item Line Composer
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 text-[10px] uppercase font-mono mb-1">Catalog Product</label>
                    <select
                      id="po-additem-select"
                      value={selectedAddProductId}
                      onChange={(e) => {
                        setVariantId('');
                        setSellingUnitId('');
                        setSelectedAddProductId(e.target.value);
                        // Autofill cost price if found
                        const prod = products.find((p) => p.id === e.target.value);
                        if (prod) {
                          setAddCost(prod.costPrice);
                        }
                      }}
                      className="w-full bg-white border border-slate-200 p-1.5 rounded text-xs focus:outline-none"
                    >
                      <option value="">-- Choose hardware catalog SKU --</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (SKU: {p.sku})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedProduct?.sharedStockUnits && (
                    <label className="text-xs">Purchasing U/M
                      <select value={sellingUnitId} className="block w-full p-2 border rounded" onChange={event=>{
                        const unit=selectedProduct.sharedStockUnits?.units.find(item=>item.id===event.target.value);
                        setSellingUnitId(event.target.value);
                        setAddCost(Math.round(selectedProduct.costPrice*(unit?.baseUnits ?? 1)*100)/100);
                      }}>
                        <option value="">Choose a unit</option>
                        {selectedProduct.sharedStockUnits.units.map(unit=><option key={unit.id} value={unit.id}>{unit.label} ({unit.baseUnits} {selectedProduct.sharedStockUnits?.baseUnit})</option>)}
                      </select>
                    </label>
                  )}
                  {!!selectedProduct?.variants?.length && (
                    <label className="text-xs">Size or variant
                      <select value={variantId} className="block w-full p-2" onChange={event => {
                        const variant = selectedProduct.variants?.find(item => item.id === event.target.value);
                        setVariantId(event.target.value);
                        setAddCost(variant?.costPrice ?? selectedProduct.costPrice);
                      }}>
                        <option value="">Choose a variant</option>
                        {selectedProduct.variants.map(item => <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>)}
                      </select>
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-400 text-[10px] uppercase font-mono mb-1">Buy Quantity</label>
                      <input
                        id="po-additem-qty"
                        type="number"
                        min="1"
                        value={addQty}
                        onChange={(e) => setAddQty(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 p-1.5 rounded font-mono text-xs focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-400 text-[10px] uppercase font-mono mb-1">Unit Cost ({currencySymbol})</label>
                      <input
                        id="po-additem-cost"
                        type="number"
                        step="0.01"
                        min="0.1"
                        value={addCost}
                        onChange={(e) => setAddCost(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 p-1.5 rounded font-mono text-xs focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAddItemLine}
                  className="w-full py-1.5 bg-slate-900 hover:bg-slate-950 text-slate-100 font-bold rounded-lg text-[10px] uppercase"
                >
                  Add line item line
                </button>
              </div>

              {/* Step 3: Lines visual checklist */}
              <div className="space-y-2.5">
                <p className="font-semibold text-slate-500">Draft Line Items checklist:</p>
                <div className="divide-y divide-slate-100 border border-slate-150 rounded-lg max-h-36 overflow-y-auto bg-white">
                  {poItems.map((lin, index) => (
                    <div key={index} className="p-2.5 flex items-center justify-between text-xs font-mono">
                      <div className="min-w-0 pr-4">
                        <p className="font-semibold text-slate-800 font-sans truncate">{lin.productName}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {lin.quantity} {lin.sellingUnitLabel || 'units'} @ {currencySymbol}{lin.costPrice} each
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-bold text-slate-900">{currencySymbol}{(lin.quantity * lin.costPrice).toFixed(2)}</span>
                        <button
                          onClick={() => handleRemoveLine(index)}
                          className="text-slate-400 hover:text-rose-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {poItems.length === 0 && (
                    <p className="text-center py-6 text-slate-400 text-[11px] font-sans">No lines compiled. Compile at least 1 purchase target above</p>
                  )}
                </div>
              </div>

              {/* Step 4: Submission */}
              <div className="sticky bottom-0 z-10 bg-white pt-3 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-slate-400 text-[10px] block font-mono">Estimated Order Cost:</span>
                  <strong className="text-slate-900 text-lg font-mono">
                    {currencySymbol}{poItems.reduce((sum, item) => sum + item.quantity * item.costPrice, 0).toFixed(2)}
                  </strong>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsPOOpen(false)}
                    className="px-3 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                  >
                    Cancel
                  </button>
                  <button
                    id="btn-po-create-submit"
                    type="button"
                    disabled={isPOSubmitting || poItems.length === 0}
                    onClick={handleCreatePurchaseRequest}
                    className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-3xs"
                  >
                    {isPOSubmitting ? 'Submitting PO draft...' : 'Create Purchase Request'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
