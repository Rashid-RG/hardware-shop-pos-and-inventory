import React, { useEffect, useMemo, useState } from 'react';
import { Database, RefreshCcw, Table2, ShieldAlert, Users, UserPlus, PencilLine, Trash2, KeyRound } from 'lucide-react';

interface DBAdminViewProps {
  authToken: string;
}

export default function DBAdminView({ authToken }: DBAdminViewProps) {
  const [tables, setTables] = useState<string[]>([]);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [rows, setRows] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [rowSearch, setRowSearch] = useState('');
  const [offset, setOffset] = useState<number>(0);
  const [limit, setLimit] = useState<string>('all');
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [userForm, setUserForm] = useState({ email: '', name: '', role: 'Cashier', password: '' });
  const [editingUserId, setEditingUserId] = useState('');
  const [userStatus, setUserStatus] = useState('');
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('');

  const authFetch = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${authToken}`);
    if (!headers.has('Content-Type') && init?.body) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...init, headers });
  };

  const loadTables = async () => {
    setIsLoadingTables(true);
    setError('');
    try {
      const res = await authFetch('/api/db-admin/tables');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load tables');
      }

      const list = data.tables || [];
      setTables(list);
      if (list.length > 0 && !selectedTable) {
        setSelectedTable(list[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load tables');
    } finally {
      setIsLoadingTables(false);
    }
  };

  const loadRows = async (tableName: string, rowLimit = limit, rowOffset = offset) => {
    if (!tableName) {
      return;
    }

    setIsLoadingRows(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if (rowLimit !== 'all') {
        query.set('limit', rowLimit);
      } else {
        query.set('limit', 'all');
      }
      if (rowOffset > 0) {
        query.set('offset', String(rowOffset));
      }
      const res = await authFetch(`/api/db-admin/table/${encodeURIComponent(tableName)}?${query.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load rows');
      }

      setRows(data.rows || []);
      setTotalRows(Number(data.totalRows || 0));
      setLimit(data.limit === null || data.limit === undefined ? 'all' : String(data.limit));
      setOffset(Number(data.offset || rowOffset));
    } catch (err: any) {
      setError(err.message || 'Failed to load rows');
    } finally {
      setIsLoadingRows(false);
    }
  };

  const loadUsers = async () => {
    setIsLoadingUsers(true);
    setUserStatus('');
    setError('');
    try {
      const res = await authFetch('/api/users');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load users');
      }
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleSyncFromAppState = async () => {
    setSyncStatus('Syncing from app_state...');
    setError('');
    try {
      const res = await authFetch('/api/db/sync-normalized', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Sync failed');
      }
      setSyncStatus('Sync completed successfully.');
      await loadRows(selectedTable || 'app_state', limit, offset);
    } catch (err: any) {
      setError(err.message || 'Sync failed');
      setSyncStatus('');
    }
  };

  const handleClearTestData = async () => {
    if (!window.confirm("WARNING: This will delete ALL products, suppliers, customers, employees, transactions, stock logs, purchase orders, quotations, and expenses. Only users and settings will be preserved. Are you sure you want to proceed?")) {
      return;
    }
    setSyncStatus('Clearing all test data...');
    setError('');
    try {
      const res = await authFetch('/api/db/clear-test-data', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to clear test data');
      }
      setSyncStatus('All test data cleared successfully. System ready for production data.');
      await loadTables();
      if (selectedTable) {
        await loadRows(selectedTable, limit, offset);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to clear test data');
      setSyncStatus('');
    }
  };

  const resetUserForm = () => {
    setEditingUserId('');
    setUserForm({ email: '', name: '', role: 'Cashier', password: '' });
  };

  const handleUserSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUserStatus('');
    setError('');
    try {
      const payload = {
        email: userForm.email.trim(),
        name: userForm.name.trim(),
        role: userForm.role,
        ...(userForm.password.trim() ? { password: userForm.password.trim() } : {}),
      };
      const res = await authFetch(editingUserId ? `/api/users/${encodeURIComponent(editingUserId)}` : '/api/users', {
        method: editingUserId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save user');
      }
      setUserStatus(editingUserId ? 'User updated successfully.' : 'User created successfully.');
      resetUserForm();
      await loadUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to save user');
    }
  };

  const handleEditUser = (user: any) => {
    setEditingUserId(user.id);
    setUserForm({
      email: user.email || '',
      name: user.name || '',
      role: user.role || 'Cashier',
      password: '',
    });
    setUserStatus('');
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Delete this user account?')) {
      return;
    }
    setUserStatus('');
    setError('');
    try {
      const res = await authFetch(`/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete user');
      }
      setUserStatus('User deleted successfully.');
      if (editingUserId === userId) {
        resetUserForm();
      }
      await loadUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (selectedTable) {
      setOffset(0);
      setSortColumn('');
      setSortDir('asc');
      loadRows(selectedTable, limit, 0);
    }
  }, [selectedTable]);

  const filteredTables = useMemo(() => {
    if (!tableSearch.trim()) {
      return tables;
    }
    const q = tableSearch.trim().toLowerCase();
    return tables.filter((table) => table.toLowerCase().includes(q));
  }, [tables, tableSearch]);

  const columnNames = useMemo(() => {
    if (rows.length === 0) {
      return [] as string[];
    }
    return Object.keys(rows[0]);
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rowSearch.trim()) {
      return rows;
    }
    const q = rowSearch.trim().toLowerCase();
    return rows.filter((row) => {
      return Object.values(row).some((val) => {
        if (val === null || val === undefined) {
          return false;
        }
        if (typeof val === 'object') {
          return JSON.stringify(val).toLowerCase().includes(q);
        }
        return String(val).toLowerCase().includes(q);
      });
    });
  }, [rows, rowSearch]);

  const sortedRows = useMemo(() => {
    if (!sortColumn) {
      return filteredRows;
    }
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const va = a[sortColumn];
      const vb = b[sortColumn];
      if (va === vb) {
        return 0;
      }
      if (va === null || va === undefined) {
        return sortDir === 'asc' ? -1 : 1;
      }
      if (vb === null || vb === undefined) {
        return sortDir === 'asc' ? 1 : -1;
      }
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return copy;
  }, [filteredRows, sortColumn, sortDir]);

  const formatCellValue = (column: string, value: any) => {
    if (value === null || value === undefined) {
      return '-';
    }
    if (
      typeof value === 'number' &&
      /(price|cost|total|amount|salary|tax|subtotal)/i.test(column)
    ) {
      return `Rs.${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  const handleSortClick = (column: string) => {
    if (sortColumn === column) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDir('asc');
  };

  const handlePrevPage = () => {
    if (limit === 'all') {
      return;
    }
    const step = Number(limit);
    const nextOffset = Math.max(0, offset - step);
    setOffset(nextOffset);
    loadRows(selectedTable, limit, nextOffset);
  };

  const handleNextPage = () => {
    if (limit === 'all') {
      return;
    }
    const step = Number(limit);
    const nextOffset = offset + step;
    if (nextOffset >= totalRows) {
      return;
    }
    setOffset(nextOffset);
    loadRows(selectedTable, limit, nextOffset);
  };

  const handleExportCsv = () => {
    if (!sortedRows.length || !columnNames.length) {
      return;
    }
    const esc = (val: any) => {
      const text = formatCellValue('', val).replaceAll('"', '""');
      return `"${text}"`;
    };
    const lines = [columnNames.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')];
    sortedRows.forEach((row) => {
      lines.push(columnNames.map((col) => esc(row[col])).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedTable || 'table'}-export.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const currentPage = limit === 'all' ? 1 : Math.floor(offset / Number(limit)) + 1;
  const totalPages = limit === 'all' ? 1 : Math.max(1, Math.ceil(totalRows / Number(limit)));

  return (
    <div className="space-y-6 motion-safe:animate-fade-in">
      <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
        <h2 className="text-xl font-heading font-semibold tracking-tight text-slate-900 flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-600" /> System Administration
        </h2>
        <p className="text-sm text-slate-500 mt-2">
          Manage employee login accounts and access roles. Raw database tables and destructive tools are not shown in the business administrator workspace.
        </p>
      </div>
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-500" /> User Accounts
            </h3>
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-amber-500" /> Create, update, and remove login accounts stored in PostgreSQL.
            </p>
          </div>
          <button
            onClick={loadUsers}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> Refresh Users
          </button>
        </div>

        {userStatus && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2 rounded-lg text-xs font-semibold">
            {userStatus}
          </div>
        )}

        <form onSubmit={handleUserSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-1 space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Email</label>
            <input
              type="email"
              value={userForm.email}
              onChange={(e) => setUserForm((current) => ({ ...current, email: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              required
            />
          </div>
          <div className="md:col-span-1 space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Name</label>
            <input
              value={userForm.name}
              onChange={(e) => setUserForm((current) => ({ ...current, name: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              required
            />
          </div>
          <div className="md:col-span-1 space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Role</label>
            <select
              value={userForm.role}
              onChange={(e) => setUserForm((current) => ({ ...current, role: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
            >
              <option>Super Admin</option>
              <option>Store Manager</option>
              <option>Cashier</option>
              <option>Inventory Staff</option>
            </select>
          </div>
          <div className="md:col-span-1 space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{editingUserId ? 'New Password' : 'Password'}</label>
            <input
              type="password"
              value={userForm.password}
              onChange={(e) => setUserForm((current) => ({ ...current, password: e.target.value }))}
              placeholder={editingUserId ? 'Leave blank to keep current password' : 'Minimum 8 characters'}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              required={!editingUserId}
            />
          </div>
          <div className="md:col-span-1 flex items-center gap-2">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              {editingUserId ? <PencilLine className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              {editingUserId ? 'Update' : 'Create'}
            </button>
            {editingUserId && (
              <button
                type="button"
                onClick={resetUserForm}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 font-semibold text-slate-500">Name</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Email</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Role</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Shop Scope</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoadingUsers ? (
                <tr>
                  <td className="px-3 py-3 text-slate-400" colSpan={5}>Loading users...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-400" colSpan={5}>No user accounts found.</td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-3 py-2 text-slate-700 font-medium">{user.name}</td>
                    <td className="px-3 py-2 text-slate-700 font-mono">{user.email}</td>
                    <td className="px-3 py-2 text-slate-700">{user.role}</td>
                    <td className="px-3 py-2 text-slate-600">{user.fixedShopId ? user.fixedShopId : (Array.isArray(user.allowedShopIds) && user.allowedShopIds.length > 0 ? user.allowedShopIds.join(', ') : 'All available')}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditUser(user)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <PencilLine className="w-3 h-3" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        For system recovery and database maintenance, use the documented Windows procedures with a verified backup.
      </p>
    </div>
  );
}
