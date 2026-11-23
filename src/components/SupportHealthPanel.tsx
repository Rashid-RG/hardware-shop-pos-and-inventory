import React, { useState } from 'react';

type Snapshot = {
  service: string;
  checkedAt: string;
  release: string;
  environment: string;
  uptimeSeconds: number;
  database: 'reachable' | 'unreachable';
  writes: 'enabled' | 'disabled';
  status: 'ready' | 'degraded';
};

export default function SupportHealthPanel({ authToken }: { authToken: string }) {
  const [result, setResult] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState('');
  const check = async () => {
    if (loading) return;
    setLoading(true);
    setMessage('');
    setResult(null);
    try {
      const response = await fetch('/api/support/diagnostics', {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      });
      const data: Snapshot | { error?: string } = await response.json();
      if (!('service' in data)) throw new Error(data.error || 'Health check failed');
      setResult(data);
      if (!response.ok) setMessage('System needs attention. Please contact your ARS support administrator.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to check system status.');
    } finally {
      setLoading(false);
    }
  };

  const copySupportSummary = async () => {
    if (!result) return;
    // The operator writes the reported issue; no customer, invoice, staff or
    // authentication details are collected automatically or sent to a server.
    const summary = [
      'ARS Hardware POS — support report',
      `Checked (UTC): ${result.checkedAt}`,
      `Release: ${result.release}`,
      `Environment: ${result.environment}`,
      `Service status: ${result.status}`,
      `Database: ${result.database}`,
      `Writes: ${result.writes}`,
      `Uptime (seconds): ${result.uptimeSeconds}`,
      `Reported issue: ${issue.trim().slice(0, 500)}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      setMessage('Technical summary copied. Share it only with your authorized support contact.');
    } catch {
      setMessage('Clipboard unavailable. Copy the values above manually.');
    }
  };
  return <section id="ars-support-health" aria-label="ARS system health and support"
    className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-base font-bold text-slate-900">System Health & Support</h3>
        <p className="mt-1 text-xs text-slate-600">
          Read-only diagnostics for managers. No passwords, database URLs or customer records are included.
        </p>
      </div>
      <button type="button" id="ars-run-health-check" disabled={loading}
        onClick={() => void check()}
        className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
        {loading ? 'Checking...' : 'Check system health'}
      </button>
    </div>
    {message && <p role="status" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">{message}</p>}
    {result && <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {[
          ['Service', result.status],
          ['Database', result.database],
          ['New invoices and changes', result.writes],
          ['Release', result.release],
          ['Environment', result.environment],
          ['Last checked', result.checkedAt],
        ].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3">
          <p className="text-slate-500">{label}</p><p className="mt-1 break-words font-bold text-slate-900">{value}</p>
        </div>)}
      </div>
      <label htmlFor="ars-support-issue" className="block text-xs font-semibold text-slate-700">
        What problem did staff experience? (do not enter private customer information)
      </label>
      <textarea id="ars-support-issue" maxLength={500} rows={2} value={issue}
        onChange={event => setIssue(event.target.value)}
        placeholder="Example: Product search was slow after opening the billing screen."
        className="w-full rounded-lg border border-slate-300 p-3 text-sm" />
      <button type="button" id="ars-copy-support-summary" onClick={() => void copySupportSummary()}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-900">
        Copy safe support summary
      </button>
      <p className="text-xs text-slate-500">Nothing is sent automatically. Report and share the summary only when needed.</p>
    </div>}
  </section>;
}
