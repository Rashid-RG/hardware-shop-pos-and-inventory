import React, { useState } from 'react';
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
import { Customer, Employee, Role, CustomerCreditPayment } from '../types';

interface CustomerEmployeeViewProps {
  viewMode: 'customers' | 'employees';
  customers: Customer[];
  employees: Employee[];
  customerCreditPayments: CustomerCreditPayment[];
  currentRole: Role;
  onAddCustomer: (custData: Omit<Customer, 'id' | 'purchaseCount'>) => Promise<void>;
  onAddEmployee: (empData: Omit<Employee, 'id' | 'performanceScore'>) => Promise<void>;
  onSetCreditLimit: (customerId: string, creditLimit: number) => Promise<void>;
  onAddCreditPayment: (payload: { customerId: string; amount: number; paymentMethod: string; date: string; note?: string }) => Promise<void>;
}

export default function CustomerEmployeeView({
  viewMode,
  customers,
  employees,
  customerCreditPayments,
  currentRole,
  onAddCustomer,
  onAddEmployee,
  onSetCreditLimit,
  onAddCreditPayment,
}: CustomerEmployeeViewProps) {
  const activeTab = viewMode;
  const [searchTerm, setSearchTerm] = useState('');

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
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentNote, setPaymentNote] = useState('');
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);

  // Employee Form states
  const [isEmpOpen, setIsEmpOpen] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState<Role>('Cashier');
  const [empPhone, setEmpPhone] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empSalary, setEmpSalary] = useState(3000);
  const [empAttendance, setEmpAttendance] = useState<'Present' | 'Absent' | 'On Leave'>('Present');
  const [isEmpSubmitting, setIsEmpSubmitting] = useState(false);

  // Hiding sensitive salaries based on logged-in role permissions
  const hidesSalaries = ['Cashier', 'Inventory Staff'].includes(currentRole);
  const canOnboard = ['Super Admin', 'Store Manager'].includes(currentRole);

  const handleSubmitCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim()) {
      alert('Must designate Customer Name');
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
      setIsCustOpen(false);
      setCustName('');
      setCustPhone('');
      setCustEmail('');
      setCustAddress('');
      setCustBalance(0);
    } catch (err) {
      alert('Failed to register customer: ' + err);
    } finally {
      setIsCustSubmitting(false);
    }
  };

  const handleSubmitEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim() || !empRole) {
      alert('Must designate staff name and role');
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
      setIsEmpOpen(false);
      setEmpName('');
      setEmpPhone('');
      setEmpEmail('');
      setEmpSalary(3000);
      setEmpAttendance('Present');
    } catch (err) {
      alert('Failed to register employee: ' + err);
    } finally {
      setIsEmpSubmitting(false);
    }
  };

  // Searching logic
  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm) ||
      c.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredEmployees = employees.filter(
    (e) =>
      e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatSalary = (amount: number) => `Rs.${amount.toLocaleString('en-US')}`;
  const formatMoney = (amount: number) => `Rs.${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const recentPaymentsForCustomer = (customerId: string) =>
    customerCreditPayments.filter((payment) => payment.customerId === customerId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);

  const handleSaveCreditLimit = async (customerId: string) => {
    const value = Number(creditEdit[customerId] ?? 0);
    if (Number.isNaN(value) || value < 0) {
      alert('Enter a valid credit limit amount.');
      return;
    }
    try {
      await onSetCreditLimit(customerId, value);
    } catch (err) {
      alert('Failed to update credit limit: ' + err);
    }
  };

  const handleSubmitCreditPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentDraft) return;
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      alert('Enter a valid payment amount.');
      return;
    }
    setIsPaymentSubmitting(true);
    try {
      await onAddCreditPayment({
        customerId: paymentDraft.id,
        amount,
        paymentMethod,
        date: paymentDate,
        note: paymentNote || undefined,
      });
      setPaymentDraft(null);
      setPaymentAmount('');
      setPaymentMethod('Cash');
      setPaymentDate(new Date().toISOString().split('T')[0]);
      setPaymentNote('');
    } catch (err) {
      alert('Failed to record customer payment: ' + err);
    } finally {
      setIsPaymentSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 motion-safe:animate-fade-in font-sans selection:bg-amber-100">
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-700">
          {activeTab === 'customers' ? 'Sales & customer relationships' : 'Operations & workforce'}
        </p>
        <h2 className="font-heading text-2xl font-bold tracking-tight text-slate-950">
          {activeTab === 'customers' ? 'Customer Management' : 'Staff Management'}
        </h2>
        <p className="text-sm leading-relaxed text-slate-500">
          {activeTab === 'customers'
            ? 'Manage customer records, credit limits, outstanding balances and payments.'
            : 'Manage staff details, roles, attendance and payroll information.'}
        </p>
      </div>

      {/* FILTER SEARCH AREA */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative w-full sm:w-85">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            id="relationship-search-input"
            type="text"
            placeholder={activeTab === 'customers' ? 'Search customers by Name, Phone, Email...' : 'Search staff members...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-50 text-slate-800 text-xs rounded-lg border border-slate-250 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          {activeTab === 'customers' ? (
            <button
              id="btn-register-customer"
              onClick={() => setIsCustOpen(true)}
              className="bg-[#182a45] hover:bg-[#294264] text-white text-xs font-bold px-4 py-3 rounded-xl flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" /> Register Customer Profile
            </button>
          ) : (
            canOnboard && (
              <button
                id="btn-onboard-employee"
                onClick={() => setIsEmpOpen(true)}
                className="bg-[#182a45] hover:bg-[#294264] text-white text-xs font-bold px-4 py-3 rounded-xl flex items-center justify-center gap-1.5 transition"
              >
                <Plus className="w-4 h-4" /> Onboard Staff Member
              </button>
            )
          )}
        </div>
      </div>

      {/* TAB 1 CONTENT: CUSTOMER DIRECTORY */}
      {activeTab === 'customers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCustomers.map((c) => (
            <div
              key={c.id}
              id={`customer-card-${c.id}`}
              className="bg-white p-5 rounded-xl border border-slate-100 shadow-2xs flex flex-col justify-between hover:shadow-xs transition"
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

                <div className="mt-4 pt-3 border-t border-slate-50 space-y-2 text-xs text-slate-600 font-mono">
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

                <div className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
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
                  <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/80 p-3 space-y-2">
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
                          setPaymentDraft(c);
                          setPaymentAmount('');
                          setPaymentMethod('Cash');
                          setPaymentDate(new Date().toISOString().split('T')[0]);
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
                )}
              </div>

              <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>Invoiced Checkouts: <strong className="text-slate-800">{c.purchaseCount}</strong></span>
              </div>
            </div>
          ))}

          {filteredCustomers.length === 0 && (
            <div className="col-span-full py-16 text-center bg-white border border-dashed border-slate-200 rounded-xl text-slate-400">
              <Users className="w-9 h-9 mx-auto opacity-40 text-slate-400" />
              <p className="text-xs font-semibold mt-2">Zero matching customers in register</p>
            </div>
          )}
        </div>
      )}

      {paymentDraft && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm border border-slate-250 font-sans relative">
            <button onClick={() => setPaymentDraft(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">Customer Credit Payment</h3>

            <form onSubmit={handleSubmitCreditPayment} className="space-y-4 text-xs font-sans">
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-slate-700">
                <div className="font-semibold">{paymentDraft.name}</div>
                <div className="text-[10px] font-mono text-slate-500 mt-1">Outstanding: {formatMoney(Number(paymentDraft.creditBalance || 0))}</div>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Amount *</label>
                <input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono" required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Method</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500">
                    <option>Cash</option>
                    <option>Bank Transfer</option>
                    <option>Credit Card</option>
                    <option>QR Code</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Date</label>
                  <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono" />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Note</label>
                <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500" placeholder="Receipt no, memo..." />
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button type="button" onClick={() => setPaymentDraft(null)} className="flex-1 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded">Cancel</button>
                <button type="submit" disabled={isPaymentSubmitting} className="flex-1 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-3xs">
                  {isPaymentSubmitting ? 'Saving...' : 'Save Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2 CONTENT: EMPLOYEE ROSTER */}
      {activeTab === 'employees' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEmployees.map((emp) => {
            const isPresent = emp.attendanceStatus === 'Present';
            const isOnLeave = emp.attendanceStatus === 'On Leave';

            return (
              <div
                key={emp.id}
                id={`employee-card-${emp.id}`}
                className="bg-white p-5 rounded-xl border border-slate-150 shadow-2xs flex flex-col justify-between hover:shadow-xs transition"
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

                  <div className="mt-4 pt-3 border-t border-slate-50 space-y-2 text-xs text-slate-600 font-mono">
                    <p className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{emp.phone}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{emp.email}</span>
                    </p>

                    {/* Salary Block under security flags */}
                    <p className="flex items-center gap-2 text-slate-700">
                      <DollarSign className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>
                        Base wage:{' '}
                        <strong>
                          {hidesSalaries ? '••••' : `${formatSalary(emp.salary)}/mo`}
                        </strong>
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span className="flex items-center gap-1">
                    <Gauge className="w-3.5 h-3.5 text-slate-450" /> Score: <strong className="text-slate-800">{emp.performanceScore}%</strong>
                  </span>
                  <div className="w-24 bg-slate-100 h-1 rounded overflow-hidden">
                    <div className="bg-amber-500 h-1 shadow-xs" style={{ width: `${emp.performanceScore}%` }}></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DIALOG 1: ADD CUSTOMER MODAL */}
      {isCustOpen && (
        <div id="customer-modal-backdrop" className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm border border-slate-250 font-sans relative">
            <button
              onClick={() => setIsCustOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">
              Onboard Loyalty Customer Profile
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
                  placeholder="e.g. Liam Neeson (Contractor)"
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
                  placeholder="+1-555-9010"
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
                  placeholder="neeson@contacting.org"
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
                  placeholder="Street 18, Houston, TX"
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
        </div>
      )}

      {/* DIALOG 2: ONBOARD STAFF MODAL */}
      {isEmpOpen && (
        <div id="employee-modal-backdrop" className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm border border-slate-250 font-sans relative">
            <button
              onClick={() => setIsEmpOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">
              Onboard Store Staff Member
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
                  placeholder="e.g. Barney Stinson"
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
                    placeholder="+1-555-2200"
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
                    placeholder="b.stinson@ironshop.com"
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
        </div>
      )}
    </div>
  );
}
