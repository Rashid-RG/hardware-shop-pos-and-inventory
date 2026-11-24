import React, { useState } from 'react';
import { Copy, DatabaseBackup, ShieldCheck, Cloud, HardDrive, RefreshCw } from 'lucide-react';

const backupScript = 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-local-postgres.ps1';

function Command({ command }: { command: string }) {
  const [feedback, setFeedback] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setFeedback('Copied');
    } catch {
      setFeedback('Select the command and copy it manually.');
    }
  }
  return <div className="space-y-2">
    <pre className="select-all whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 text-xs text-amber-100">{command}</pre>
    <div className="flex items-center gap-3">
      <button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-semibold">
        <Copy size={14} /> Copy command
      </button>
      <span role="status" className="text-xs text-slate-600">{feedback}</span>
    </div>
  </div>;
}

export default function BackupRecoveryView({ authToken }: { authToken: string }) {
  const [local, setLocal] = useState<{enabled: boolean; running: boolean; platform: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Array<{name:string; bytes:number; createdAt:string; complete:boolean; includesUploads:boolean}>>([]);
  const [historyError, setHistoryError] = useState('');
  const [action, setAction] = useState('');
  const [verified, setVerified] = useState<Record<string,string>>({});
  const [historyMessage, setHistoryMessage] = useState('');
  async function refreshHistory() {
    try {
      const response = await fetch('/api/backup/local-history', {headers: {Authorization: 'Bearer ' + authToken}});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'History unavailable');
      setHistory(data.backups); setHistoryError('');
    } catch (err) { setHistoryError(err instanceof Error ? err.message : 'History unavailable'); }
  }
  React.useEffect(() => { if (local?.enabled) void refreshHistory(); }, [local?.enabled, authToken]);
  async function verifySet(name: string) {
    setAction(name); setHistoryMessage('');
    try {
      const response = await fetch('/api/backup/local-verify', {method:'POST', headers:{Authorization:'Bearer '+authToken,'Content-Type':'application/json'}, body:JSON.stringify({archive:name})});
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Verification failed');
      setVerified(old => ({...old,[name]:data.verifiedAt}));
      setHistoryMessage('All backup checksums match. A recovery drill is still required.');
    } catch (err) { setHistoryMessage(err instanceof Error ? err.message : 'Verification failed'); }
    finally { setAction(''); }
  }
  async function downloadSetMember(name:string, member:string) {
    setAction(name); setHistoryMessage('');
    try {
      const response = await fetch('/api/backup/local-download?' + new URLSearchParams({archive:name,member}), {headers:{Authorization:'Bearer '+authToken}});
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Download failed'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href=url; link.download=member; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setHistoryMessage('Download requested. Keep every file in the set together on encrypted storage.');
    } catch(err) { setHistoryMessage(err instanceof Error ? err.message : 'Download failed'); }
    finally { setAction(''); }
  }
  const [result, setResult] = useState<{archive: string; verifiedAt: string} | null>(null);
  const [error, setError] = useState('');
  const headers = { Authorization: 'Bearer ' + authToken };
  React.useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/backup/local-status', { headers, signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) setLocal(data);
      } catch { if (!controller.signal.aborted) setLocal(null); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [authToken]);
  async function runBackup() {
    if (busy || !local?.enabled || local.running) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/backup/local-run', { method: 'POST', headers });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Backup failed.');
      setResult({ archive: data.archive, verifiedAt: data.verifiedAt });
      setVerified(old => ({...old,[data.archive]:data.verifiedAt}));
      void refreshHistory();
    } catch (err) { setError(err instanceof Error ? err.message : 'Backup failed.'); }
    finally { setBusy(false); }
  }
  const [status, setStatus] = useState<{phase: string; verifiedAt: string | null; attemptedAt: string | null} | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch('/api/backup/drive-status', { headers: { Authorization: 'Bearer ' + authToken }, signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) setStatus(data);
      } catch {
        if (!controller.signal.aborted) setStatus({ phase: 'unavailable', verifiedAt: null, attemptedAt: null });
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [authToken]);
  const labels: Record<string, string> = {
    never: 'No daily run recorded', verified: 'Upload verified', local: 'Creating local backup',
    upload: 'Uploading and checking files', 'local-failed': 'Local backup failed',
    'upload-failed': 'Upload or verification failed', unavailable: 'Status unavailable',
  };
  const overdue = status?.verifiedAt && Date.now() - Date.parse(status.verifiedAt) > 24 * 3600000;
  const [mint, setMint] = useState(() => /Linux/.test(navigator.platform) && !/Android/.test(navigator.userAgent));
  const [archive, setArchive] = useState('');
  // Accept names produced by both generations of the Windows archive script.
  const valid = /^[a-z0-9_-][a-z0-9_. -]*\.dump$/i.test(archive);
  const path = '"backups/' + archive + '"';
  const card = 'min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
  return <div className="space-y-4 text-sm text-slate-700">
    <header className="rounded-xl bg-[#152945] p-5 text-white">
      <h2 className="flex items-center gap-2 text-xl font-bold"><DatabaseBackup /> Backup &amp; recovery</h2>
      <p className="mt-1 text-slate-200">Protect business records and uploaded files. Create and verify a local backup from this workspace.</p>
    </header>
    <div className="grid gap-3 lg:grid-cols-3">
      <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
        <div className="flex items-start gap-3"><HardDrive className="h-6 w-6 text-amber-700"/><div className="flex-1"><h3 className="font-bold text-slate-900">Local database backup</h3><p className="mt-1 text-xs text-slate-600">Creates the database archive and available uploads, then verifies their checksums.</p></div></div>
        <button type="button" disabled={busy || !!action || !local?.enabled || local.running} onClick={runBackup} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-3 font-bold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"><DatabaseBackup size={18}/>{busy || local?.running ? 'Backup in progress…' : 'Back up now'}</button>
        {!local?.enabled && <p className="mt-2 text-xs text-slate-600">{local ? 'One-click backup is disabled on this host. Enable it in the server configuration first.' : 'Checking backup service availability…'}</p>}
        {busy && <p role="status" className="mt-2 flex items-center gap-2 text-xs"><RefreshCw className="h-4 w-4 animate-spin"/> Creating and verifying the backup. Keep this page open.</p>}
        {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
        {result && <div role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900"><strong className="flex items-center gap-2"><ShieldCheck size={16}/> Backup created and checksums verified</strong><p className="mt-1 break-all">{result.archive}</p><p>{new Date(result.verifiedAt).toLocaleString()} · Saved on database computer</p><p className="mt-1">A separate recovery test is still recommended.</p></div>}
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4"><Cloud className="h-6 w-6 text-slate-600"/><h3 className="mt-2 font-bold text-slate-900">Google Drive backup</h3><p className="mt-1 text-xs">{status ? labels[status.phase] || 'Unknown status' : 'Checking status…'}</p><p className="mt-2 text-xs text-slate-500">Cloud setup and scheduling remain separate from the local backup button.</p></section>
    </div>
    {local?.enabled && <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2"><div><h3 className="font-bold text-slate-900">Local backup history</h3><p className="text-xs text-slate-500">Backup sets retained on this database computer.</p></div><button type="button" onClick={refreshHistory} className="rounded-lg border px-3 py-2 text-xs font-semibold">Refresh</button></div>
      {historyError && <p role="alert" className="text-rose-700 text-xs">{historyError}</p>}
      {historyMessage && <p role="status" className="rounded-lg bg-slate-50 p-2 text-xs">{historyMessage}</p>}
      {!history.length && !historyError && <p className="text-xs text-slate-500">No managed local backup sets found.</p>}
      <div className="space-y-2">{history.map(row => <div key={row.name} className="rounded-lg border p-3">
        <div className="flex flex-wrap justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{new Date(row.createdAt).toLocaleString()}</p><p className="break-all text-xs text-slate-500">{row.name}</p><p className="text-xs text-slate-600">{(row.bytes/1048576).toFixed(2)} MB database · {row.includesUploads?'Includes uploads':'Database only'}</p></div><span className="text-xs font-medium">{verified[row.name]?'Checksums verified this session':row.complete?'Files present · not yet verified':'Incomplete set'}</span></div>
        <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={!row.complete || busy || !!action || local.running} onClick={()=>verifySet(row.name)} className="rounded border px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Verify set</button>
        {[row.name,row.name+'.sha256',...(row.includesUploads?[row.name.slice(0,-5)+'-uploads.zip',row.name.slice(0,-5)+'-uploads.zip.sha256']:[])].map((member,i)=><button key={member} type="button" disabled={!row.complete || busy || !!action || local.running} onClick={()=>downloadSetMember(row.name,member)} className="rounded border px-3 py-1.5 text-xs disabled:opacity-40">{['Database','Database checksum','Uploads ZIP','Uploads checksum'][i]}</button>)}</div>
      </div>)}</div>
    </section>}
    <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-semibold text-slate-800">Advanced setup, verification and recovery tools</summary>
    <div className="mt-4 space-y-4">
    <label className="block text-sm font-semibold">Database computer
      <select value={mint ? 'mint' : 'windows'} onChange={event => setMint(event.target.value === 'mint')} className="ml-2 rounded border px-2 py-1">
        <option value="mint">Linux Mint</option><option value="windows">Windows</option>
      </select>
    </label>
    <section className={card}>
      <h3 className="text-base font-bold text-slate-900">Daily Google Drive backup</h3>
      <p role="status">{status ? labels[status.phase] : 'Loading status…'}{status?.verifiedAt && ' · Last verified ' + new Date(status.verifiedAt).toLocaleString()}</p>
      {overdue && <p className="font-semibold text-amber-800">More than 24 hours since the last verified upload.</p>}
      <details><summary className="cursor-pointer font-semibold">Set up on the database computer</summary>
        <ol className="my-3 list-decimal space-y-1 pl-5">
          <li>Install rclone and run <code>rclone config</code>. Create a Google Drive remote named <code>ars-drive</code> using the ARS business account.</li>
          <li>Create a crypt remote named <code>ars-encrypted</code> pointing to <code>ars-drive:ARS-Backups</code>. Save the encryption password and salt offline for recovery.</li>
          <li>Register the schedule below. It runs at 8 PM local time while the configured user is signed in. Keep Docker running.</li>
        </ol>
        <Command command={mint ? 'bash scripts/mint/install-drive-backup.sh' : 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-drive-backup.ps1 -At 20:00'}/>
        <p className="my-2">ARS keeps the latest 30 local backup sets. Drive keeps each uploaded set until the owner removes it.</p>
        <p className="my-2">Run the scheduled task once now and check the verified time above.</p>
        <Command command={mint ? 'systemctl --user start ars-drive-backup.service' : "Start-ScheduledTask -TaskName 'ARS Hardware - Daily Drive Backup'"}/>
      </details>
      <details><summary className="cursor-pointer font-semibold">Download a set for a recovery drill</summary>
        <p className="my-2">List the dated folders, then replace SET with one folder name. Download into the project backups folder and follow the restore steps below.</p>
        <Command command="rclone lsf ars-encrypted:daily --dirs-only"/>
        <Command command={'rclone copy "ars-encrypted:daily/SET" backups --immutable'}/>
      </details>
    </section>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className={card}>
        <h3 className="text-base font-bold text-slate-900">1. Create a backup</h3>
        <p>Run the command below. Keep the dump, its checksum and any matching uploads ZIP and ZIP checksum together. Copy the set to encrypted external storage.</p>
        <Command command={mint ? 'python3 scripts/mint/backup.py' : backupScript}/>
      </section>
      <section className={card}>
        <h3 className="text-base font-bold text-slate-900">2. Check the backup files</h3>
        <p>Place the complete set in the project’s backups folder. Choose the dump there to prepare commands for that filename.</p>
        <label className="block font-semibold">Database archive
          <input type="file" accept=".dump" className="mt-2 block w-full text-xs" onChange={event => setArchive(event.target.files?.[0]?.name ?? '')}/>
        </label>
        {archive && !valid && <p role="alert">Choose an ARS .dump file with its original filename.</p>}
        {valid && <Command key={archive} command={'node scripts/verify-backup.mjs ' + path}/>}
      </section>
    </div>
    <section className={card}>
      <h3 className="text-base font-bold text-slate-900">3. Test recovery in a separate database</h3>
      <p>The drill checks the files, asks you to type <strong>RESTORE TEST</strong>, and restores into a new database. Compare the reported product, customer and sales counts with your records. Inspect the recovered logos and product images in the temporary folder printed by the script.</p>
      {valid ? <Command key={archive} command={(mint ? 'python3 scripts/mint/backup.py --restore ' : 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-local-postgres-test.ps1 -BackupFile ') + path}/> :
        <p className="text-xs font-semibold text-amber-800">Choose a database archive above to prepare the restore command.</p>}
    </section>
    {valid && <fieldset key={archive} className={card}>
      <legend className="px-1 font-bold">Manual checklist for this archive</legend>
      <label className="flex items-center gap-2"><input type="checkbox" /> Backup set copied to encrypted external storage.</label>
      <label className="flex items-center gap-2"><input type="checkbox" /> Restored records and available uploads inspected.</label>
      <p className="text-xs text-slate-500">These reminders apply to this screen session.</p>
    </fieldset>}
    <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <strong>Recovering after a failure?</strong> Stop entering transactions, preserve the original database, and review the isolated copy before switching the POS connection. The drill leaves the working database and uploads in place.
    </aside>
    </div></details>
  </div>;
}
