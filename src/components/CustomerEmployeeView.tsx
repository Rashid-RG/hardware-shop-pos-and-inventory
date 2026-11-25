import { reportDay } from '../utils/reporting';
import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { notify } from '../utils/notifications';
import {
  Users,
  UserCheck,
  Plus,
  Search,
  Mail,
  Phone,
  MapPin,
  Award,
  DollarSign,
  Briefcase,
  X,
  Gauge,
  Wallet,
  Receipt,
} from 'lucide-react';
import { Customer, Employee, Role, CustomerCreditPayment, SalesTransaction, StoreSettings } from '../types';
import { CustomerLedgerPanel } from './CustomerLedgerPanel';
import { CustomerReportsView } from './CustomerReportsView';


type PendingCollection = {requestId:string;customerId:string;invoiceId?:string;amount:number;paymentMethod:string;date:string;note?:string;destinationAccountId?:string};
type CollectionAccount={id:string;name:string;kind:string;active:boolean};
interface CustomerEmployeeViewProps {
  paymentDraftOwner:string;
  collectionAuthToken?:string;
  collectionShopId?:string;
  taxConfig: StoreSettings;
  viewMode: 'customers' | 'employees';
  customers: Customer[];
  employees: Employee[];
  customerCreditPayments: CustomerCreditPayment[];
  transactions: SalesTransaction[];
  currentRole: Role;
  onAddCustomer: (custData: Omit<Customer, 'id' | 'purchaseCount'>) => Promise<void>;
  onUpdateCustomer: (customerId: string, details: Pick<Customer, 'name' | 'phone' | 'email' | 'address'>) => Promise<void>;
  onAddEmployee: (empData: Omit<Employee, 'id' | 'performanceScore'>) => Promise<void>;
  onSetCreditLimit: (customerId: string, creditLimit: number) => Promise<void>;
  onAddCreditPayment: (payload: PendingCollection) => Promise<CustomerCreditPayment>;
  onFetchPaymentReceipt: (paymentId:string)=>Promise<Blob>;
}

export default function CustomerEmployeeView({
  taxConfig,
  viewMode,
  customers,
  employees,
  customerCreditPayments,
  transactions,
  currentRole,
  onAddCustomer,
  onUpdateCustomer,
  onAddEmployee,
  onSetCreditLimit,
  paymentDraftOwner,
  collectionAuthToken,
  collectionShopId,
  onAddCreditPayment,
  onFetchPaymentReceipt,
}: CustomerEmployeeViewProps) {
  const activeTab = viewMode;
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleCount, setVisibleCount] = useState(12);
  const [staffFileId,setStaffFileId]=useState<string|null>(null);
  const staffFile=employees.find(emp=>emp.id===staffFileId);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerFileTab, setCustomerFileTab] = useState<'overview'|'ledger'|'activity'>('overview');
  useEffect(()=>setCustomerFileTab('overview'),[selectedCustomerId]);
  const [isReportsOpen, setIsReportsOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editDetails, setEditDetails] = useState({ name: '', phone: '', email: '', address: '' });
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [customerHistorySearch, setCustomerHistorySearch] = useState('');
  const [customerHistoryFrom, setCustomerHistoryFrom] = useState('');
  const [customerHistoryTo, setCustomerHistoryTo] = useState('');
  const [customerHistoryType, setCustomerHistoryType] = useState<'all' | 'invoices' | 'payments'>('all');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'owing' | 'clear'>('all');


  // Customer Form states
  const [isCustOpen, setIsCustOpen] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custBalance, setCustBalance] = useState(0);
  const [isCustSubmitting, setIsCustSubmitting] = useState(false);
  const [creditEdit, setCreditEdit] = useState<Record<string, string>>({});
  const [paymentDraft, setPaymentDraft] = useState<Customer | null>(null);
  const [paymentInvoiceId,setPaymentInvoiceId]=useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentDate, setPaymentDate] = useState(reportDay(new Date()));
  const [paymentNote, setPaymentNote] = useState('');
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const paymentStorageKey='ars:pending-collection:'+JSON.stringify([paymentDraftOwner,taxConfig.activeShopId]);
  const [pendingCollection,setPendingCollection]=useState<PendingCollection|null>(()=>{try{return JSON.parse(localStorage.getItem(paymentStorageKey)||'null');}catch{return null;}});
  const paymentLock=useRef(false);
  const [destinationAccountId,setDestinationAccountId]=useState('');
  const [collectionAccounts,setCollectionAccounts]=useState<CollectionAccount[]>([]);
  const [destinationError,setDestinationError]=useState('');
  const [destinationLoading,setDestinationLoading]=useState(false);
  const representativeCollection=currentRole==='Cashier';
  const [representativeBalance,setRepresentativeBalance]=useState<number|null>(null);
  const destinationEnabled=!!collectionAuthToken&&!!collectionShopId&&['Super Admin','Store Manager'].includes(currentRole);
  const compatibleDestinations=collectionAccounts.filter(a=>a.active&&(paymentMethod==='Cash'?['Office Cash','Representative Cash'].includes(a.kind):paymentMethod==='Bank Transfer'?a.kind==='Bank':false));
  useEffect(()=>{
    setDestinationAccountId('');setCollectionAccounts([]);setDestinationError('');
    setRepresentativeBalance(null);setDestinationLoading(false);
    if(!paymentDraft||(!destinationEnabled&&!representativeCollection))return;
    if(representativeCollection&&(!collectionAuthToken||!collectionShopId)){setDestinationError('Representative account access is unavailable.');return;}
    const controller=new AbortController();
    setDestinationLoading(true);
    fetch(representativeCollection?'/api/representative/me':'/api/financial-accounts',{headers:{Authorization:'Bearer '+collectionAuthToken,'X-Shop-Id':collectionShopId||''},cache:'no-store',signal:controller.signal})
      .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load destinations.');if(representativeCollection){if(!data.accountId||!data.accountName||!Number.isFinite(data.balance))throw Error('Assigned cash account unavailable.');if(!controller.signal.aborted){setRepresentativeBalance(data.balance);setDestinationAccountId(data.accountId);}return [{id:data.accountId,name:data.accountName,kind:'Representative Cash',active:true}] as CollectionAccount[];}if(!Array.isArray(data))throw Error('Unable to load destinations.');return data as CollectionAccount[];})
      .then(data=>{if(!controller.signal.aborted)setCollectionAccounts(data);})
      .catch(error=>{if(!controller.signal.aborted)setDestinationError(error.message||'Unable to load destinations.');})
      .finally(()=>{if(!controller.signal.aborted)setDestinationLoading(false);});
    return ()=>controller.abort();
  },[paymentDraft?.id,destinationEnabled,representativeCollection,collectionAuthToken,collectionShopId]);


  // Employee Form states
  const [isEmpOpen, setIsEmpOpen] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState<Role>('Cashier');
  const [empPhone, setEmpPhone] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empSalary, setEmpSalary] = useState(3000);
  const [empAttendance, setEmpAttendance] = useState<'Present' | 'Absent' | 'On Leave'>('Present');
  const [isEmpSubmitting, setIsEmpSubmitting] = useState(false);

  const beginCustomerEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setEditDetails({ name: customer.name, phone: customer.phone, email: customer.email, address: customer.address });
  };

  const saveCustomerEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingCustomer || !editDetails.name.trim()) {
      notify.warning('Customer shop name is required.');
      return;
    }
    setIsEditingCustomer(true);
    try {
      await onUpdateCustomer(editingCustomer.id, {
        name: editDetails.name.trim(),
        phone: editDetails.phone.trim(),
        email: editDetails.email.trim(),
        address: editDetails.address.trim(),
      });
      setEditingCustomer(null);
      notify.success('Customer details updated.');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update customer.');
    } finally {
      setIsEditingCustomer(false);
    }
  };

  // Hiding sensitive salaries based on logged-in role permissions
  const hidesSalaries = ['Cashier', 'Inventory Staff'].includes(currentRole);
  const canOnboard = ['Super Admin', 'Store Manager'].includes(currentRole);

  const handleSubmitCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim()) {
      notify.warning('Must designate Customer Name');
      return;
    }
    setIsCustSubmitting(true);
    try {
      await onAddCustomer({
        name: custName,
        phone: custPhone,
        email: custEmail,
        address: custAddress,
        loyaltyBalance: custBalance,
      });
      notify.success('Customer shop registered successfully.');
      setIsCustOpen(false);
      setCustName('');
      setCustPhone('');
      setCustEmail('');
      setCustAddress('');
      setCustBalance(0);
    } catch (err) {
      notify.error('Failed to register customer: ' + err);
    } finally {
      setIsCustSubmitting(false);
    }
  };

  const handleSubmitEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim() || !empRole) {
      notify.warning('Must designate staff name and role');
      return;
    }
    setIsEmpSubmitting(true);
    try {
      await onAddEmployee({
        name: empName,
        role: empRole,
        phone: empPhone,
        email: empEmail,
        salary: empSalary,
        attendanceStatus: empAttendance,
      });
      notify.success('Sales Representative registered successfully.');
      setIsEmpOpen(false);
      setEmpName('');
      setEmpPhone('');
      setEmpEmail('');
      setEmpSalary(3000);
      setEmpAttendance('Present');
    } catch (err) {
      notify.error('Failed to register employee: ' + err);
    } finally {
      setIsEmpSubmitting(false);
    }
  };

  // The customer directory shows only matching customers, but the detail
  // workspace always uses the complete scoped records, not the card preview.
  const normalizedCustomerSearch = searchTerm.trim().toLowerCase();
  const filteredCustomers = customers.filter((c) => {
    const matchesText = [c.name, c.id, c.phone, c.email, c.address]
      .some((value) => String(value || '').toLowerCase().includes(normalizedCustomerSearch));
    const matchesBalance = balanceFilter === 'all'
      || (balanceFilter === 'owing' ? Number(c.creditBalance || 0) > 0 : Number(c.creditBalance || 0) <= 0);
    return matchesText && matchesBalance;
  });
  const owingCustomers = customers.filter(c=>Number(c.creditBalance || 0)>0);
  const outstandingTotal = owingCustomers.reduce((sum,c)=>sum+Number(c.creditBalance || 0),0);
  const directoryCustomers = balanceFilter === 'owing' ? [...filteredCustomers].sort((a,b)=>Number(b.creditBalance || 0)-Number(a.creditBalance || 0)||a.name.localeCompare(b.name)) : filteredCustomers;

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
  const matchesShop = (recordShopId?: string) =>
    !selectedCustomer?.shopId || recordShopId === selectedCustomer.shopId;
  const selectedInvoices = selectedCustomer
    ? transactions.filter((tx) => tx.customerId === selectedCustomer.id && matchesShop(tx.shopId))
    : [];
  const selectedPayments = selectedCustomer
    ? customerCreditPayments.filter((payment) =>
        payment.customerId === selectedCustomer.id && matchesShop(payment.shopId))
    : [];

  const selectedInvoice = selectedInvoices.find((invoice) => invoice.id === selectedInvoiceId);
  const invoiceCollectionSummary=(tx:SalesTransaction)=>{
    const total=Number(tx.total||0);
    if(tx.status==='Refunded')return {status:'Refunded',paid:0,balance:0,uncertain:false};
    if(tx.paymentMethod!=='Credit Account'){
      const paid=tx.paymentStatus==='UNPAID'?0:Math.min(total,Math.max(0,Number(tx.cashReceived??total)));
      return {status:paid>=total?'Paid':paid>0?'Partially paid':'Unpaid',paid,balance:Math.max(0,total-paid),uncertain:false};
    }
    const uncertain=selectedPayments.some(p=>!p.invoiceId);
    const paid=Math.round(selectedPayments.filter(p=>p.invoiceId===tx.id).reduce((sum,p)=>sum+Number(p.amount),0)*100)/100;
    const balance=Math.max(0,Math.round((total-paid)*100)/100);
    return {status:uncertain?'Reconciliation required':balance===0?'Paid':paid>0?'Partially paid':'Unpaid',paid,balance,uncertain};
  };
  const selectedCollectionSummary=selectedInvoice?invoiceCollectionSummary(selectedInvoice):null;
  const normalizedHistorySearch = customerHistorySearch.trim().toLowerCase();
  const historyRows = [
    ...(customerHistoryType === 'payments' ? [] : selectedInvoices.map((tx) => ({
      id: tx.id, type: 'Invoice' as const, date: tx.date, reference: tx.invoiceNumber,
      description: `${tx.items.length} product line(s) · ${tx.paymentMethod}`,
      amount: Number(tx.total || 0), status: invoiceCollectionSummary(tx).status,
    }))),
    ...(customerHistoryType === 'invoices' ? [] : selectedPayments.map((payment) => ({
      id: payment.id, type: 'Payment' as const, date: payment.date,
      reference: payment.invoiceId ? selectedInvoices.find(tx=>tx.id===payment.invoiceId)?.invoiceNumber || payment.invoiceId : payment.paymentMethod, description: payment.note || 'Credit repayment',
      amount: Number(payment.amount || 0), status: 'Received',
    }))),
  ].filter((row) => {
    const date = reportDay(row.date);
    const text = [row.reference, row.description, row.status, row.type].join(' ').toLowerCase();
    return (!customerHistoryFrom || date >= customerHistoryFrom)
      && (!customerHistoryTo || date <= customerHistoryTo)
      && (!normalizedHistorySearch || text.includes(normalizedHistorySearch));
  }).sort((left, right) => String(right.date).localeCompare(String(left.date)));

  const openCustomerFile = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setSelectedInvoiceId(null);
    setCustomerHistorySearch('');
    setCustomerHistoryFrom('');
    setCustomerHistoryTo('');
    setCustomerHistoryType('all');
  };

  const filteredEmployees = employees.filter(
    (e) =>
      e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const customerDirectoryReport = ():BusinessReport => ({
    title:'Customer directory',filename:'ars-customer-directory',period:'Current matching customers',
    headers:['Customer ID','Shop name','Phone','Email','Address','Credit limit (LKR)','Outstanding (LKR)','Invoice count'],
    rows:filteredCustomers.map(c=>[c.id,c.name,c.phone,c.email,c.address,Number(c.creditLimit||0),Number(c.creditBalance||0),c.purchaseCount]),moneyColumns:[5,6],
    summary:[{label:'Matching customers',value:filteredCustomers.length},{label:'Outstanding (LKR)',value:filteredCustomers.reduce((sum,c)=>sum+Number(c.creditBalance||0),0)}]
  });
  const customerStatementReport = ():BusinessReport => {
    if(!selectedCustomer)throw new Error('Select a customer first.');
    return {title:'Customer statement — '+selectedCustomer.name,filename:'ars-customer-statement-'+selectedCustomer.id.replace(/[^a-zA-Z0-9_-]/g,''),period:(customerHistoryFrom||'All dates')+' to '+(customerHistoryTo||'Latest')+' | '+customerHistoryType,
    headers:['Customer ID','Shop name','Date','Record type','Reference','Details','Status','Amount (LKR)'],
    rows:historyRows.map(row=>[selectedCustomer.id,selectedCustomer.name,reportDay(row.date),row.type,row.reference,row.description,row.status,row.amount]),moneyColumns:[7],
    summary:[{label:'Matching activity records',value:historyRows.length},{label:'Current outstanding (LKR; not period total)',value:Number(selectedCustomer.creditBalance||0)}]};
  };

  const staffReport = ():BusinessReport => ({
 title:'Staff directory',filename:'ars-staff',period:'Matching employees',headers:['Name','Role','Phone','Email','Attendance','Performance score',...(!hidesSalaries?['Salary (LKR)']:[])],moneyColumns:!hidesSalaries?[6]:[],
 rows:filteredEmployees.map(e=>[e.name,e.role,e.phone,e.email,e.attendanceStatus,e.performanceScore,...(!hidesSalaries?[e.salary]:[])]),summary:[{label:'Matching employees',value:filteredEmployees.length}]
 });
  const formatSalary = (amount: number) => `Rs.${amount.toLocaleString('en-US')}`;
  const formatMoney = (amount: number) => `Rs.${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const recentPaymentsForCustomer = (customerId: string) =>
    customerCreditPayments.filter((payment) => payment.customerId === customerId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);

  const handleSaveCreditLimit = async (customerId: string) => {
    const value = Number(creditEdit[customerId] ?? 0);
    if (Number.isNaN(value) || value < 0) {
      notify.warning('Enter a valid credit limit amount.');
      return;
    }
    try {
      await onSetCreditLimit(customerId, value);
      notify.success('Customer credit limit updated.');
    } catch (err) {
      notify.error('Failed to update credit limit: ' + err);
    }
  };

  const collectionPayments=customerCreditPayments.filter(p=>p.customerId===paymentDraft?.id&&p.shopId===paymentDraft?.shopId);
  const hasUnallocatedCollections=collectionPayments.some(p=>!p.invoiceId);
  const collectibleInvoices=transactions.filter(tx=>tx.customerId===paymentDraft?.id&&tx.shopId===paymentDraft?.shopId&&tx.paymentMethod==='Credit Account'&&tx.status==='Completed').map(tx=>({id:tx.id,number:tx.invoiceNumber,date:tx.date,balance:Math.round((Number(tx.total)-collectionPayments.filter(p=>p.invoiceId===tx.id).reduce((sum,p)=>sum+Number(p.amount),0))*100)/100})).filter(tx=>tx.balance>0);
  const selectedCollectionInvoice=collectibleInvoices.find(tx=>tx.id===paymentInvoiceId);
  const collectionMaximum=Math.min(Number(paymentDraft?.creditBalance||0),hasUnallocatedCollections?Number(paymentDraft?.creditBalance||0):selectedCollectionInvoice?.balance||0);

  const collectionAmount=Number(paymentAmount);
  const validCollectionAmount=Number.isFinite(collectionAmount)&&collectionAmount>0&&collectionAmount<=collectionMaximum&&Math.abs(collectionAmount*100-Math.round(collectionAmount*100))<1e-6;
  const collectionDestinationReady=representativeCollection ? paymentMethod==='Cash'&&!destinationLoading&&compatibleDestinations.some(a=>a.id===destinationAccountId) : !(destinationEnabled&&['Cash','Bank Transfer'].includes(paymentMethod))||(!destinationLoading&&compatibleDestinations.some(a=>a.id===destinationAccountId));
  const collectionReady=validCollectionAmount&&collectionDestinationReady&&(hasUnallocatedCollections||!!selectedCollectionInvoice)&&!!paymentDate&&paymentDate<=reportDay(new Date());

  const openPaymentReceipt=async(paymentId:string,mode:'print'|'download',preview?:Window|null)=>{
    let target=preview;
    if(mode==='print'&&target===undefined)target=window.open('','_blank');
    try{
      const blob=await onFetchPaymentReceipt(paymentId);
      const url=URL.createObjectURL(blob);
      if(mode==='print'&&target&&!target.closed){
        target.location.replace(url);
        target.focus();
        const cleanup=window.setInterval(()=>{if(target?.closed){URL.revokeObjectURL(url);window.clearInterval(cleanup);}},5000);
      }else{
        const link=document.createElement('a');link.href=url;link.download='payment-'+paymentId+'.pdf';document.body.appendChild(link);link.click();link.remove();
        window.setTimeout(()=>URL.revokeObjectURL(url),60000);
        if(mode==='print')notify.warning('Print preview unavailable. Receipt downloaded instead.');
      }
    }catch(error){target?.close();notify.warning('Payment receipt unavailable. Do not record the payment again; retry from payment history.');}
  };

  const handleSubmitCreditPayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!paymentDraft || isPaymentSubmitting || paymentLock.current || pendingCollection) return;
    const amount = Number(paymentAmount);
    if(!hasUnallocatedCollections&&!selectedCollectionInvoice){notify.warning('Select an unpaid invoice.');return;}
    if(!Number.isFinite(amount)||amount>collectionMaximum){notify.warning('Payment exceeds the outstanding balance.');return;}
    if (!validCollectionAmount) {
      notify.warning('Enter a valid payment amount.');
      return;
    }
    if(representativeCollection&&(paymentMethod!=='Cash'||destinationLoading||!compatibleDestinations.some(a=>a.id===destinationAccountId))){notify.warning('Your assigned representative cash account must be available before collection.');return;}
    if(destinationEnabled&&['Cash','Bank Transfer'].includes(paymentMethod)&&!compatibleDestinations.some(a=>a.id===destinationAccountId)){notify.warning('Select a valid financial destination.');return;}
    if(!collectionReady){notify.warning('Check the payment amount, date and receiving account.');return;}
    const printRequested=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('data-receipt')==='print';
    const preview=printRequested?window.open('','_blank'):undefined;
    if(preview)preview.document.body.textContent='Saving payment…';
    const request:PendingCollection={
        requestId:crypto.randomUUID(),
        customerId: paymentDraft.id,
        invoiceId: hasUnallocatedCollections?undefined:paymentInvoiceId,
        amount,
        paymentMethod,
        destinationAccountId: (destinationEnabled||representativeCollection)&&compatibleDestinations.some(a=>a.id===destinationAccountId)?destinationAccountId:undefined,
        date: paymentDate,
        note: paymentNote || undefined,
      };
    try{localStorage.setItem(paymentStorageKey,JSON.stringify(request));}catch{preview?.close();notify.error('Cannot safely preserve payment request. Check browser storage.');return;}
    setPendingCollection(request);
    await submitPreservedCollection(request,printRequested,preview);
  };
  const submitPreservedCollection=async(request:PendingCollection,printRequested=false,preview?:Window|null)=>{
    if(paymentLock.current)return;
    paymentLock.current=true;
    setIsPaymentSubmitting(true);
    try{
      const savedPayment=await onAddCreditPayment(request);
      localStorage.removeItem(paymentStorageKey);
      setPendingCollection(null);
      notify.success('Customer payment recorded.');
      setPaymentDraft(null);
      setPaymentAmount('');
      setPaymentMethod('Cash');
      setPaymentDate(reportDay(new Date()));
      setPaymentNote('');
      if(printRequested)await openPaymentReceipt(savedPayment.id,'print',preview);
    } catch (err) {
      preview?.close();
      notify.error('Payment outcome not confirmed. Retry the preserved request; do not enter a new payment. '+err);
    } finally {
      paymentLock.current=false;
      setIsPaymentSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 motion-safe:animate-fade-in font-sans selection:bg-amber-100">
      {pendingCollection&&<section role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm">
        <strong>Unconfirmed payment request</strong>
        <p>Rs. {pendingCollection.amount.toFixed(2)} · {pendingCollection.paymentMethod} · {pendingCollection.date}</p>
        <p>Retry this exact request before recording another payment. This will not deduct the amount twice.</p>
        <button type="button" disabled={isPaymentSubmitting} onClick={()=>void submitPreservedCollection(pendingCollection)} className="mt-2 rounded bg-amber-400 px-4 py-2 font-semibold disabled:opacity-40">Retry saved payment request</button>
      </section>}
      {activeTab === 'customers' && <section aria-label="Customer account overview" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button type="button" aria-pressed={balanceFilter==='all'} onClick={()=>{setBalanceFilter('all');setSearchTerm('');setVisibleCount(12);}} className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-indigo-400"><span className="block text-xs text-slate-500">Customer accounts</span><strong className="block text-lg text-slate-900">{customers.length}</strong></button>
        <button type="button" aria-pressed={balanceFilter==='owing'} onClick={()=>{setBalanceFilter('owing');setSearchTerm('');setVisibleCount(12);}} className="rounded-xl border border-rose-200 bg-white p-3 text-left hover:border-rose-400"><span className="block text-xs text-slate-500">Total positive outstanding</span><strong className="block text-lg text-rose-700 break-words">{formatMoney(outstandingTotal)}</strong><span className="text-xs text-slate-500">{owingCustomers.length} accounts owing · View accounts</span></button>
        <button type="button" aria-pressed={balanceFilter==='clear'} onClick={()=>{setBalanceFilter('clear');setSearchTerm('');setVisibleCount(12);}} className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-emerald-400"><span className="block text-xs text-slate-500">No outstanding balance</span><strong className="block text-lg text-emerald-700">{customers.length-owingCustomers.length}</strong></button>
      </section>}
      {/* FILTER SEARCH AREA */}
      <div className="bg-white px-3 py-2.5 rounded-xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative w-full sm:w-85">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            id="relationship-search-input"
            type="text"
            placeholder={activeTab === 'customers' ? 'Search customers by Name, Phone, Email...' : 'Search staff members...'}
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setVisibleCount(12); }}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-50 text-slate-800 text-xs rounded-lg border border-slate-250 focus:outline-none focus:border-amber-500"
          />
        </div>

        {activeTab === 'customers' && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="ars-customer-balance-filter" className="text-xs font-semibold text-slate-600">Balance</label>
            <select id="ars-customer-balance-filter" value={balanceFilter}
              onChange={(e) => { setBalanceFilter(e.target.value as typeof balanceFilter); setVisibleCount(12); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="all">All customers</option>
              <option value="owing">Outstanding</option>
              <option value="clear">No outstanding</option>
            </select>
            <span className="text-xs text-slate-500">{filteredCustomers.length} matching customer(s)</span>
            <button type="button" id="ars-open-customer-reports" onClick={() => setIsReportsOpen(true)}
              className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-800">
              Open customer reports
            </button>
            <ReportExportMenu report={customerDirectoryReport} settings={taxConfig}/>
          </div>
        )}
        {activeTab==='employees'&&canOnboard&&<ReportExportMenu report={staffReport} settings={taxConfig}/>}
        <div>
          {activeTab === 'customers' ? (
            <button
              id="btn-register-customer"
              onClick={() => setIsCustOpen(true)}
              className="bg-[#182a45] hover:bg-[#294264] text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" /> Add Customer Shop
            </button>
          ) : (
            canOnboard && (
              <button
                id="btn-onboard-employee"
                onClick={() => setIsEmpOpen(true)}
                className="bg-[#182a45] hover:bg-[#294264] text-white text-xs font-bold px-4 py-3 rounded-xl flex items-center justify-center gap-1.5 transition"
              >
                <Plus className="w-4 h-4" /> Add Sales Representative
              </button>
            )
          )}
        </div>
      </div>

      {/* TAB 1 CONTENT: CUSTOMER DIRECTORY */}
      {activeTab === 'customers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[72dvh] overflow-y-auto overscroll-contain">
          {directoryCustomers.slice(0, visibleCount).map((c) => (
            <div
              key={c.id}
              id={`customer-card-${c.id}`}
              className="bg-white p-3 rounded-xl border border-slate-100 shadow-2xs flex flex-col justify-between hover:shadow-xs transition"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-sans font-bold text-slate-900 text-sm">{c.name}</h4>
                    <span className="text-[9px] font-mono font-bold text-slate-400 block tracking-wider uppercase mt-0.5">
                      Customer ID: {c.id}
                    </span>
                  </div>

                  <span className="flex items-center gap-1 bg-amber-50 text-amber-700 text-[10px] font-mono font-bold px-2 py-0.5 rounded">
                    <Award className="w-3.5 h-3.5 shrink-0 text-amber-500" /> {c.loyaltyBalance} PTS
                  </span>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-50 space-y-1 text-xs text-slate-600 font-mono">
                  <p className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{c.phone}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{c.email}</span>
                  </p>
                  <p className="flex items-center gap-2 font-sans text-slate-500 text-[11px]">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{c.address}</span>
                  </p>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-lg border border-amber-100 bg-amber-50 p-2">
                    <p className="uppercase font-semibold text-amber-700">Credit Limit</p>
                    <p className="font-mono font-bold text-slate-900 mt-1">{formatMoney(Number(c.creditLimit || 0))}</p>
                  </div>
                  <div className={`rounded-lg border p-2 ${Number(c.creditBalance || 0) > 0 ? 'border-rose-100 bg-rose-50' : 'border-emerald-100 bg-emerald-50'}`}>
                    <p className={`uppercase font-semibold ${Number(c.creditBalance || 0) > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>Credit Balance</p>
                    <p className={`font-mono font-bold mt-1 ${Number(c.creditBalance || 0) > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatMoney(Number(c.creditBalance || 0))}</p>
                  </div>
                </div>

                {c.id !== 'cust-walkin' && (
                  <details className="mt-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2 space-y-2">
                    <summary className="cursor-pointer py-1 text-xs font-semibold text-slate-700">Credit actions & recent payments</summary>
                    <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        value={creditEdit[c.id] ?? String(Number(c.creditLimit || 0))}
                        onChange={(e) => setCreditEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        className="flex-1 bg-white border border-slate-200 p-2 rounded text-xs font-mono focus:outline-none focus:border-amber-500"
                        placeholder="Set credit limit"
                      />
                      <button onClick={() => handleSaveCreditLimit(c.id)} className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold">
                        Save Limit
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500">Record repayment against outstanding balance.</span>
                      <button
                        onClick={() => {
                          setPaymentDraft(c);setPaymentInvoiceId('');
                          setPaymentAmount('');
                          setPaymentMethod('Cash');
                          setPaymentDate(reportDay(new Date()));
                          setPaymentNote('');
                        }}
                        className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold flex items-center gap-1"
                      >
                        <Wallet className="w-3.5 h-3.5" /> Record Payment
                      </button>
                    </div>

                    {recentPaymentsForCustomer(c.id).length > 0 && (
                      <div className="border-t border-slate-100 pt-2 space-y-1 text-[10px] font-mono text-slate-600">
                        {recentPaymentsForCustomer(c.id).map((payment) => (
                          <div key={payment.id} className="flex items-center justify-between gap-2">
                            <span>{payment.date} • {payment.paymentMethod}</span>
                            <strong className="text-emerald-700">{formatMoney(payment.amount)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                    </div>
                  </details>
                )}
              </div>

              <button type="button" onClick={() => openCustomerFile(c.id)}
                className="mt-2 w-full rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
                Open customer file
              </button>
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>Invoiced Checkouts: <strong className="text-slate-800">{c.purchaseCount}</strong></span>
              </div>
            </div>
          ))}

          {filteredCustomers.length > visibleCount && (
            <button type="button" className="col-span-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => setVisibleCount(value => value + 12)}>
              Show 12 more customer shops ({filteredCustomers.length - visibleCount} remaining)
            </button>
          )}

          {filteredCustomers.length === 0 && (
            <div className="col-span-full py-16 text-center bg-white border border-dashed border-slate-200 rounded-xl text-slate-400">
              <Users className="w-9 h-9 mx-auto opacity-40 text-slate-400" />
              <p className="text-xs font-semibold mt-2">No matching customer accounts</p><button type="button" onClick={()=>{setSearchTerm('');setBalanceFilter('all');setVisibleCount(12);}} className="mt-2 text-xs font-semibold text-indigo-700 underline">Clear filters</button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'customers' && isReportsOpen && (
        <CustomerReportsView customers={customers} settings={taxConfig} invoices={transactions}
          payments={customerCreditPayments} onClose={() => setIsReportsOpen(false)} />
      )}

      {activeTab === 'customers' && selectedCustomer && createPortal(
        <div id="ars-customer-workspace" role="dialog" aria-modal="true" aria-label="Customer details and full history"
          className="fixed inset-0 z-[100] flex flex-col bg-slate-50 font-sans">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Customer file</p>
              <h2 className="text-lg font-bold text-slate-900">{selectedCustomer.name}</h2>
              <p className="text-xs text-slate-500">Customer ID: {selectedCustomer.id}</p>
              {canOnboard && selectedCustomer.id !== 'cust-walkin' && (
                <button type="button" onClick={() => beginCustomerEdit(selectedCustomer)}
                  className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-800">
                  Edit shop details
                </button>
              )}
            </div>
            <button type="button" onClick={() => setSelectedCustomerId(null)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100">
              <X className="mr-1 inline-block h-4 w-4" /> Close customer file
            </button>
          </header>
          <nav aria-label="Customer file sections" className="flex shrink-0 gap-2 border-b bg-white px-3 py-2">{([["overview","Overview"],["ledger","Account ledger"],["activity","Invoices & payments"]] as const).map(([id,label])=><button key={id} type="button" aria-pressed={customerFileTab===id} onClick={()=>setCustomerFileTab(id)} className={customerFileTab===id?"rounded-lg bg-[#182a45] px-3 py-2 text-xs font-bold text-white":"rounded-lg px-3 py-2 text-xs font-semibold text-slate-600"}>{label}</button>)}</nav>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
            <div className="mx-auto max-w-7xl space-y-3">
              <div hidden={customerFileTab!=="overview"} className="space-y-3"><section className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
                <div><p className="text-xs text-slate-500">Phone</p><p className="break-words font-semibold">{selectedCustomer.phone || 'Not provided'}</p></div>
                <div><p className="text-xs text-slate-500">Email</p><p className="break-words font-semibold">{selectedCustomer.email || 'Not provided'}</p></div>
                <div><p className="text-xs text-slate-500">Address</p><p className="break-words font-semibold">{selectedCustomer.address || 'Not provided'}</p></div>
                <div><p className="text-xs text-slate-500">Recorded purchases</p><p className="font-semibold">{selectedInvoices.length} invoices</p></div>
              </section>
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Credit limit</p><p className="mt-1 text-lg font-bold">{formatMoney(Number(selectedCustomer.creditLimit || 0))}</p></div>
                <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Outstanding balance</p><p className="mt-1 text-lg font-bold text-rose-700">{formatMoney(Number(selectedCustomer.creditBalance || 0))}</p></div>
                <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Recorded credit payments</p><p className="mt-1 text-lg font-bold">{formatMoney(selectedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0))}</p></div>
              </section>
              </div>
              <div hidden={customerFileTab!=="ledger"} key={selectedCustomer.id}>
                <CustomerLedgerPanel customer={selectedCustomer} settings={taxConfig}
                  invoices={selectedInvoices} payments={selectedPayments} />
              </div>
              <section hidden={customerFileTab!=="activity"} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div><h3 className="text-lg font-bold">Complete customer activity</h3>
                    <p className="text-xs text-slate-500">All matching records are shown; no recent-only limit. Invoice amounts and credit payments are different record types.</p></div>
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800">{historyRows.length} matching records</span>
                </div>
                <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div><label htmlFor="customer-history-search" className="mb-1 block text-xs font-semibold">Search activity</label>
                    <input id="customer-history-search" value={customerHistorySearch} onChange={(e) => setCustomerHistorySearch(e.target.value)}
                      placeholder="Invoice, reference or notes" className="w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></div>
                  <div><label htmlFor="customer-history-type" className="mb-1 block text-xs font-semibold">Record type</label>
                    <select id="customer-history-type" value={customerHistoryType}
                      onChange={(e) => setCustomerHistoryType(e.target.value as typeof customerHistoryType)}
                      className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm">
                      <option value="all">Invoices and payments</option><option value="invoices">Invoices only</option><option value="payments">Payments only</option>
                    </select></div>
                  <div><label htmlFor="customer-history-from" className="mb-1 block text-xs font-semibold">From date</label>
                    <input id="customer-history-from" type="date" value={customerHistoryFrom}
                      onChange={(e) => setCustomerHistoryFrom(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></div>
                  <div><label htmlFor="customer-history-to" className="mb-1 block text-xs font-semibold">To date</label>
                    <input id="customer-history-to" type="date" value={customerHistoryTo}
                      onChange={(e) => setCustomerHistoryTo(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2.5 text-sm" /></div>
                </div>
                <div className="max-h-[48dvh] overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[650px] text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600"><tr>
                      <th className="p-3">Date</th><th className="p-3">Record</th>
                      <th className="p-3">Reference</th><th className="p-3">Details</th>
                      <th className="p-3">Status</th><th className="p-3 text-right">Amount</th><th className="p-3">Receipt</th>
                    </tr></thead>
                    <tbody>
                      {historyRows.map((row) => (
                        <tr key={`${row.type}-${row.id}`} className="border-t border-slate-100">
                          <td className="whitespace-nowrap p-3">{reportDay(row.date)}</td>
                          <td className="p-3 font-semibold">{row.type}</td>
                          <td className="p-3">{row.type === 'Invoice' ? (
                            <button type="button" onClick={() => setSelectedInvoiceId(row.id)}
                              className="font-semibold text-indigo-700 underline-offset-2 hover:underline">
                              {row.reference} · View items
                            </button>
                          ) : row.reference}</td>
                          <td className="p-3">{row.description}</td>
                          <td className="p-3">{row.status}</td>
                          <td className="p-3 text-right font-semibold">{formatMoney(row.amount)}</td>
                          <td className="p-3">{row.type==='Payment'&&<div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void openPaymentReceipt(row.id,'print')} className="rounded border px-2 py-1 text-xs font-semibold">Reprint</button><button type="button" onClick={()=>void openPaymentReceipt(row.id,'download')} className="rounded border px-2 py-1 text-xs font-semibold">PDF</button></div>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {historyRows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No records match these filters.</p>}
                </div>
                {selectedInvoice && (
                  <section aria-label="Selected customer invoice details" className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold uppercase text-indigo-700">Invoice details</p>
                        <h4 className="text-base font-bold">{selectedInvoice.invoiceNumber}</h4>
                        <p className="text-xs text-slate-600">{reportDay(selectedInvoice.date)} · {selectedInvoice.paymentMethod} · {selectedInvoice.status || 'Completed'}</p>
                      </div>
                      <button type="button" onClick={() => setSelectedInvoiceId(null)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold">Close invoice details</button>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="w-full min-w-[600px] text-left text-sm">
                        <thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr>
                          <th className="p-2">Product</th><th className="p-2">Description</th>
                          <th className="p-2 text-right">Qty</th><th className="p-2 text-right">Price</th>
                          <th className="p-2 text-right">Discount</th>
                        </tr></thead>
                        <tbody>{selectedInvoice.items.map((item, index) => (
                          <tr key={`${item.productId}-${index}`} className="border-t border-slate-100">
                            <td className="p-2 font-semibold">{item.productName}{item.variantName ? ` · ${item.variantName}` : ''}</td>
                            <td className="p-2 text-slate-600">{item.invoiceDescription || '—'}</td>
                            <td className="p-2 text-right">{item.quantity}</td>
                            <td className="p-2 text-right">{formatMoney(Number(item.sellingPrice || 0))}</td>
                            <td className="p-2 text-right">{Number(item.discount || 0)}%{Number(item.discountAmount || 0) > 0 ? ` + ${formatMoney(Number(item.discountAmount))}` : ''}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      <p>Subtotal: <strong>{formatMoney(Number(selectedInvoice.subtotal || 0))}</strong></p>
                      <p>Invoice discount: <strong>{formatMoney(Number(selectedInvoice.discountAmount || 0))}</strong></p>
                      <p>Tax: <strong>{formatMoney(Number(selectedInvoice.tax || 0))}</strong></p>
                      <p>Total: <strong>{formatMoney(Number(selectedInvoice.total || 0))}</strong></p>
                    </div>
                    {selectedCollectionSummary&&<div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2"><strong>Payment status: {selectedCollectionSummary.status}</strong>
                      {!selectedCollectionSummary.uncertain&&selectedCollectionSummary.balance>0&&selectedInvoice.paymentMethod==='Credit Account'&&selectedCustomer&&<button type="button" onClick={()=>{setPaymentDraft(selectedCustomer);setPaymentInvoiceId(selectedInvoice.id);setPaymentAmount('');setPaymentMethod('Cash');setPaymentDate(reportDay(new Date()));setPaymentNote('');}} className="rounded bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Record payment for this invoice</button>}</div>
                      {selectedCollectionSummary.uncertain?<p className="mt-2 text-xs text-amber-800">Older account payments have no invoice reference. Exact invoice balances require reconciliation.</p>:selectedInvoice.status!=='Refunded'&&<div className="mt-2 grid grid-cols-2 gap-2 text-sm"><p>Collected: <strong>{formatMoney(selectedCollectionSummary.paid)}</strong></p><p>Outstanding: <strong>{formatMoney(selectedCollectionSummary.balance)}</strong></p></div>}
                    </div>}
                  </section>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <ReportExportMenu report={customerStatementReport} settings={taxConfig}/>
                  <button type="button" onClick={() => { setCustomerHistorySearch(''); setCustomerHistoryFrom(''); setCustomerHistoryTo(''); setCustomerHistoryType('all'); }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold hover:bg-slate-50">Clear activity filters</button>
                  {selectedCustomer.id !== 'cust-walkin' && (
                    <button type="button" onClick={() => { setPaymentDraft(selectedCustomer);setPaymentInvoiceId(''); setPaymentAmount(''); setPaymentMethod('Cash'); setPaymentDate(reportDay(new Date())); }}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800">Record credit repayment</button>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>, document.body
      )}

      {editingCustomer && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Edit customer shop details"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3">
          <form onSubmit={saveCustomerEdit}
            className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div><h2 className="text-lg font-bold">Edit customer shop</h2>
                <p className="text-xs text-slate-500">Contact details only. Invoice history and balances stay unchanged.</p></div>
              <button type="button" onClick={() => setEditingCustomer(null)} aria-label="Close customer editor"
                className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><label htmlFor="customer-edit-name" className="mb-1 block text-sm font-semibold">Shop name *</label>
                <input id="customer-edit-name" required maxLength={160} value={editDetails.name}
                  onChange={(e) => setEditDetails((d) => ({ ...d, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 p-3 text-sm" /></div>
              <div><label htmlFor="customer-edit-phone" className="mb-1 block text-sm font-semibold">Phone</label>
                <input id="customer-edit-phone" maxLength={60} value={editDetails.phone}
                  onChange={(e) => setEditDetails((d) => ({ ...d, phone: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 p-3 text-sm" /></div>
              <div><label htmlFor="customer-edit-email" className="mb-1 block text-sm font-semibold">Email</label>
                <input id="customer-edit-email" type="email" maxLength={254} value={editDetails.email}
                  onChange={(e) => setEditDetails((d) => ({ ...d, email: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 p-3 text-sm" /></div>
              <div className="sm:col-span-2"><label htmlFor="customer-edit-address" className="mb-1 block text-sm font-semibold">Shop address</label>
                <textarea id="customer-edit-address" maxLength={1000} rows={3} value={editDetails.address}
                  onChange={(e) => setEditDetails((d) => ({ ...d, address: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 p-3 text-sm" /></div>
            </div>
            <div className="flex gap-2 border-t border-slate-200 p-4">
              <button type="button" onClick={() => setEditingCustomer(null)}
                className="flex-1 rounded-lg border border-slate-300 p-3 text-sm font-semibold">Cancel</button>
              <button type="submit" disabled={isEditingCustomer}
                className="flex-1 rounded-lg bg-indigo-700 p-3 text-sm font-bold text-white disabled:opacity-50">
                {isEditingCustomer ? 'Saving...' : 'Save customer'}
              </button>
            </div>
          </form>
        </div>, document.body
      )}

      {paymentDraft && !pendingCollection && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 z-[120]">
          <div className="bg-white rounded-xl shadow-2xl p-4 w-full max-w-md border border-slate-250 font-sans relative max-h-[90dvh] overflow-y-auto">
            <button onClick={() => setPaymentDraft(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">Record Customer Payment</h3>

            <form onSubmit={handleSubmitCreditPayment} className="space-y-2.5 text-xs font-sans">
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-slate-700">
                <div className="font-semibold">{paymentDraft.name}</div>
                <div className="text-[10px] font-mono text-slate-500 mt-1">Outstanding: {formatMoney(Number(paymentDraft.creditBalance || 0))}</div>
              </div>

              <div>
                {hasUnallocatedCollections?<p role="status" className="mb-2 rounded bg-amber-50 p-2 text-amber-900">Historical payments are not allocated to invoices. Record against the customer account until reconciled.</p>:<>
                  <label htmlFor="collection-invoice" className="block font-semibold mb-1">Outstanding invoice *</label>
                  <select id="collection-invoice" required value={paymentInvoiceId} onChange={e=>{setPaymentInvoiceId(e.target.value);setPaymentAmount('');}} className="mb-2 w-full rounded border p-2">
                    <option value="">Select an invoice</option>
                    {[...collectibleInvoices].sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(tx=><option key={tx.id} value={tx.id}>{tx.number} · {reportDay(tx.date)} · {formatMoney(tx.balance)}</option>)}
                  </select>
                  {selectedCollectionInvoice&&<p className="mb-2 font-semibold">Invoice outstanding: {formatMoney(selectedCollectionInvoice.balance)}</p>}
                </>}
                {!hasUnallocatedCollections&&!collectibleInvoices.length&&<p role="status" className="mb-2 rounded bg-amber-50 p-2 text-amber-900">No collectible invoice found. Reconcile the account before recording a payment.</p>}
                <label className="block text-slate-500 font-semibold mb-1">Amount *</label>
                <input type="number" min="0.01" max={collectionMaximum} step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono" required />
                <div className="mt-2 flex flex-wrap gap-2">{collectionMaximum>0&&<button type="button" onClick={()=>setPaymentAmount(collectionMaximum.toFixed(2))} className="rounded border border-indigo-200 px-3 py-1.5 font-semibold text-indigo-700">Pay maximum · {formatMoney(collectionMaximum)}</button>}</div>
                {paymentAmount!==''&&!validCollectionAmount&&<p role="alert" className="mt-2 text-rose-700">Enter a valid amount up to {formatMoney(Math.max(0,collectionMaximum))}, with at most two decimal places.</p>}
                {validCollectionAmount&&<div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2"><div><span className="block text-slate-500">Account remaining (estimate)</span><strong>{formatMoney(Number(paymentDraft.creditBalance||0)-collectionAmount)}</strong></div>{!hasUnallocatedCollections&&selectedCollectionInvoice&&<div><span className="block text-slate-500">Invoice remaining</span><strong>{formatMoney(selectedCollectionInvoice.balance-collectionAmount)}</strong></div>}</div>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Method</label>
                  <select value={paymentMethod} onChange={(e) => {setPaymentMethod(e.target.value);setDestinationAccountId('');}} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500">
                    <option>Cash</option>
                    {!representativeCollection&&<><option>Bank Transfer</option><option>Credit Card</option><option>QR Code</option></>}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Date</label>
                  <input type="date" required max={reportDay(new Date())} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono" />
                </div>
              </div>

              {representativeCollection&&<div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1"><p className="font-semibold">Your assigned cash account</p>{destinationLoading?<p role="status">Loading account…</p>:destinationError?<p role="alert" className="text-red-700">{destinationError}</p>:compatibleDestinations.length?<><p>{compatibleDestinations[0].name}</p><p>Recorded cash held: {formatMoney(representativeBalance??0)}</p><p className="text-xs text-slate-500">Cash will be posted automatically to your assigned account.</p></>:<p className="text-amber-800">Ask a Super Admin to link your account before collecting.</p>}</div>}
              {destinationEnabled&&['Cash','Bank Transfer'].includes(paymentMethod)&&<div>
                <label htmlFor="collection-destination" className="block text-slate-500 font-semibold mb-1">Received into *</label>
                <select id="collection-destination" required disabled={destinationLoading||isPaymentSubmitting} value={destinationAccountId} onChange={e=>setDestinationAccountId(e.target.value)} className="w-full rounded border p-2">
                  <option value="">{destinationLoading?'Loading accounts…':'Select financial account'}</option>
                  {compatibleDestinations.map(a=><option key={a.id} value={a.id}>{a.name} · {a.kind}</option>)}
                </select>
                {destinationError?<p role="alert" className="text-red-700 text-xs">{destinationError}</p>:!destinationLoading&&!compatibleDestinations.length?<p className="text-xs text-amber-800">Create a matching active account in Accounting before collecting.</p>:null}
              </div>}
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Note</label>
                <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500" placeholder="Receipt no, memo..." />
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button type="button" onClick={() => setPaymentDraft(null)} className="flex-1 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded">Cancel</button>
                <button type="submit" disabled={!!pendingCollection || isPaymentSubmitting || !collectionReady} className="flex-1 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-3xs">
                  {isPaymentSubmitting ? 'Saving...' : 'Save Payment'}
                </button>
                <button type="submit" data-receipt="print" disabled={!!pendingCollection || isPaymentSubmitting || !collectionReady} className="flex-1 rounded bg-amber-400 px-2 py-2 text-xs font-bold text-slate-900 disabled:opacity-40">Save &amp; Print Receipt</button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}

      {/* TAB 2 CONTENT: EMPLOYEE ROSTER */}
      {activeTab === 'employees' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[70dvh] overflow-y-auto overscroll-contain auto-rows-min">
          {filteredEmployees.slice(0, visibleCount).map((emp) => {
            const isPresent = emp.attendanceStatus === 'Present';
            const isOnLeave = emp.attendanceStatus === 'On Leave';

            return (
              <div
                key={emp.id}
                id={`employee-card-${emp.id}`}
                className="bg-white p-3 rounded-xl border border-slate-150 shadow-2xs flex flex-col justify-between hover:shadow-xs transition"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 pr-2">
                      <h4 className="font-sans font-bold text-slate-900 text-sm truncate">{emp.name}</h4>
                      <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mt-0.5 truncate flex items-center gap-1.5">
                        <Briefcase className="w-3.5 h-3.5 text-slate-400" /> {emp.role}
                      </p>
                    </div>

                    <span
                      className={`px-2.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded ${
                        isPresent
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-150'
                          : isOnLeave
                          ? 'bg-amber-50 text-amber-800 border border-amber-150'
                          : 'bg-rose-50 text-rose-800 border-rose-150'
                      }`}
                    >
                      {emp.attendanceStatus}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-slate-600 truncate">{emp.phone || 'No phone registered'}</p>
                </div>
                <button type="button" onClick={()=>setStaffFileId(emp.id)} className="mt-2 w-full rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">Open representative profile</button>
              </div>
            );
          })}
          {filteredEmployees.length > visibleCount && (
            <button type="button" className="col-span-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => setVisibleCount(value => value + 12)}>
              Show 12 more representatives ({filteredEmployees.length - visibleCount} remaining)
            </button>
          )}
        </div>
      )}

      {activeTab==='employees'&&staffFile&&createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3">
          <section role="dialog" aria-modal="true" aria-label="Sales representative profile" className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <header className="flex items-center justify-between bg-[#182a45] px-4 py-3 text-white"><div><p className="text-xs text-amber-300">SALES REPRESENTATIVE</p><h2 className="font-bold">{staffFile.name}</h2></div><button type="button" aria-label="Close representative profile" onClick={()=>setStaffFileId(null)}><X className="h-5 w-5"/></button></header>
            <div className="grid grid-cols-2 gap-3 overflow-y-auto p-4 text-sm">
              <div><p className="text-xs text-slate-500">Role</p><strong>{staffFile.role}</strong></div><div><p className="text-xs text-slate-500">Attendance status</p><strong>{staffFile.attendanceStatus}</strong></div>
              <div><p className="text-xs text-slate-500">Phone</p><p className="break-words">{staffFile.phone||'—'}</p></div><div><p className="text-xs text-slate-500">Email</p><p className="break-words">{staffFile.email||'—'}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Monthly base wage</p><strong>{hidesSalaries?'••••':formatSalary(staffFile.salary)}</strong></div><div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Performance score</p><strong>{staffFile.performanceScore}%</strong></div>
            </div>
            <footer className="border-t p-3"><button type="button" onClick={()=>setStaffFileId(null)} className="w-full rounded-lg bg-slate-100 py-2 text-xs font-bold">Back to staff directory</button></footer>
          </section>
        </div>,document.body)}
      {/* DIALOG 1: ADD CUSTOMER MODAL */}
      {isCustOpen && createPortal(
        <div id="customer-modal-backdrop" className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[120]">
          <div className="bg-white rounded-xl shadow-2xl p-4 w-full max-w-lg max-h-[90dvh] overflow-y-auto border border-slate-250 font-sans relative">
            <button
              onClick={() => setIsCustOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">
              Register Wholesale Customer Shop
            </h3>

            <form onSubmit={handleSubmitCustomer} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Customer Name *</label>
                <input
                  id="input-cust-name"
                  type="text"
                  required
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="Registered shop name"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Contact Number</label>
                <input
                  id="input-cust-phone"
                  type="text"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="e.g. 07X XXX XXXX"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Email Coordinates</label>
                <input
                  id="input-cust-email"
                  type="email"
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                  placeholder="shop@example.lk"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Billing Location Address</label>
                <input
                  id="input-cust-address"
                  type="text"
                  value={custAddress}
                  onChange={(e) => setCustAddress(e.target.value)}
                  placeholder="Shop address, town, Sri Lanka"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Starting Franchise Loyalty Points (PTS)</label>
                <input
                  id="input-cust-balance"
                  type="number"
                  min="0"
                  value={custBalance}
                  onChange={(e) => setCustBalance(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCustOpen(false)}
                  className="flex-1 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  Cancel
                </button>
                <button
                  id="btn-cust-onboard-submit"
                  type="submit"
                  disabled={isCustSubmitting}
                  className="flex-1 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-3xs"
                >
                  {isCustSubmitting ? 'Registering customer...' : 'Register customer'}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}

      {/* DIALOG 2: ONBOARD STAFF MODAL */}
      {isEmpOpen && createPortal(
        <div id="employee-modal-backdrop" className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[120]">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm border border-slate-250 font-sans relative">
            <button
              onClick={() => setIsEmpOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">
              Register Sales Representative
            </h3>

            <form onSubmit={handleSubmitEmployee} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Staff Member Name *</label>
                <input
                  id="input-emp-name"
                  type="text"
                  required
                  value={empName}
                  onChange={(e) => setEmpName(e.target.value)}
                  placeholder="Representative full name"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Designated Store Operations Role</label>
                <select
                  id="input-emp-role"
                  value={empRole}
                  onChange={(e) => setEmpRole(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 text-xs"
                >
                  <option value="Super Admin">Super Admin</option>
                  <option value="Store Manager">Store Manager</option>
                  <option value="Cashier">Cashier</option>
                  <option value="Inventory Staff">Inventory Staff</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Phone Contact</label>
                  <input
                    id="input-emp-phone"
                    type="text"
                    value={empPhone}
                    onChange={(e) => setEmpPhone(e.target.value)}
                    placeholder="e.g. 07X XXX XXXX"
                    className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Email coordinates</label>
                  <input
                    id="input-emp-email"
                    type="email"
                    value={empEmail}
                    onChange={(e) => setEmpEmail(e.target.value)}
                    placeholder="representative@example.lk"
                    className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-400 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Base Monthly Salary (Rs.)</label>
                <input
                  id="input-emp-salary"
                  type="number"
                  min="500"
                  value={empSalary}
                  onChange={(e) => setEmpSalary(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Initial Shift Status</label>
                <select
                  id="input-emp-attendance"
                  value={empAttendance}
                  onChange={(e) => setEmpAttendance(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none text-xs"
                >
                  <option value="Present">Present (On Duty)</option>
                  <option value="Absent">Absent (Off duty)</option>
                  <option value="On Leave">On Approved Leave</option>
                </select>
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsEmpOpen(false)}
                  className="flex-1 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  Cancel
                </button>
                <button
                  id="btn-emp-onboard-submit"
                  type="submit"
                  disabled={isEmpSubmitting}
                  className="flex-1 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-3xs"
                >
                  {isEmpSubmitting ? 'Onboarding staff...' : 'Onboard Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}
    </div>
  );
}
