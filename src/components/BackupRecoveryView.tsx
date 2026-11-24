import React, { useState } from 'react';
import { Copy, DatabaseBackup } from 'lucide-react';

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
      <p className="mt-2 text-slate-200">Run these commands from the ARS project folder on the database computer.</p>
    </header>
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
  </div>;
}
