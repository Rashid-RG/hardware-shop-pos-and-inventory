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

export default function BackupRecoveryView() {
  const [archive, setArchive] = useState('');
  // Accept names produced by both generations of the Windows archive script.
  const valid = /^[a-z0-9_-][a-z0-9_. -]*\.dump$/i.test(archive);
  const path = '"backups\\' + archive + '"';
  const card = 'min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
  return <div className="space-y-4 text-sm text-slate-700">
    <header className="rounded-xl bg-[#152945] p-5 text-white">
      <h2 className="flex items-center gap-2 text-xl font-bold"><DatabaseBackup /> Backup &amp; recovery</h2>
      <p className="mt-2 text-slate-200">Run these commands from the ARS project folder in PowerShell on the Windows database computer.</p>
    </header>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className={card}>
        <h3 className="text-base font-bold text-slate-900">1. Create a backup</h3>
        <p>Double-click <strong>Backup-Hardware-POS.bat</strong> or use the command below. Keep the dump, its checksum and any matching uploads ZIP and ZIP checksum together. Copy the set to encrypted external storage.</p>
        <Command command={backupScript}/>
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
      {valid ? <Command key={archive} command={'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-local-postgres-test.ps1 -BackupFile ' + path}/> :
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
