import React,{useState} from 'react';
import {DatabaseBackup, ShieldCheck, Copy, CheckCircle, AlertTriangle, HardDriveDownload, RotateCcw} from 'lucide-react';

const backupCommand='powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-local-postgres.ps1';
const restoreCommand='powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-local-postgres-test.ps1 -BackupFile "backups\\YOUR-BACKUP-FILE.dump"';

export default function BackupRecoveryView(){
 const [copied,setCopied]=useState('');
 const [checks,setChecks]=useState({external:false,isolated:false});
 const copy=(command:string,key:string)=>{void navigator.clipboard?.writeText(command).then(()=>setCopied(key)).catch(()=>setCopied(''));};
 const shell=(title:string,command:string,key:string)=>(
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
   <div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-bold text-slate-900">{title}</p>
    <button type="button" onClick={()=>copy(command,key)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-amber-50"><Copy className="h-4 w-4"/>{copied===key?'Copied':'Copy command'}</button></div>
   <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#142641] p-3 text-xs text-amber-100">{command}</pre>
  </div>);
 return <div className="space-y-5">
  <header className="rounded-2xl bg-[#152945] p-6 text-white">
   <p className="text-xs font-bold uppercase tracking-widest text-amber-300">Super Admin · Data Protection</p>
   <h2 className="mt-2 flex items-center gap-2 font-heading text-2xl font-bold"><DatabaseBackup className="h-6 w-6"/>Database Backup & Recovery</h2>
   <p className="mt-2 max-w-3xl text-sm text-slate-300">Preserve every wholesale invoice, importer shipment, customer balance, product, supplier, and partner capital record. Backups must be verified outside the operational database.</p>
  </header>
  <div className="grid gap-4 lg:grid-cols-2">
   <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h3 className="flex items-center gap-2 font-bold"><HardDriveDownload className="h-5 w-5 text-amber-600"/>1. Create full database backup</h3>
    <p className="text-sm leading-relaxed text-slate-600">On the Windows computer that hosts PostgreSQL, open PowerShell in the ARS POS project folder. The script reads the active database name from <code>.env.local</code> rather than assuming the old demo database.</p>
    {shell('Run on the ARS database computer',backupCommand,'backup')}
    <p className="text-xs leading-relaxed text-slate-500">Creates a PostgreSQL custom-format .dump plus a SHA-256 checksum in the backups folder. Copy both files to an encrypted external drive or trusted encrypted storage.</p>
   </section>
   <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h3 className="flex items-center gap-2 font-bold"><RotateCcw className="h-5 w-5 text-amber-600"/>2. Verify safe restore</h3>
    <p className="text-sm leading-relaxed text-slate-600">Replace the placeholder with the actual .dump path, including its matching .sha256 file. The recovery script verifies the checksum and creates a NEW isolated database.</p>
    {shell('Restore test only — never into operational ARS',restoreCommand,'restore')}
    <p className="text-xs leading-relaxed text-slate-500">The script refuses an existing or active database as target. It retains the test database for independent inspection. It does not switch the POS to the test database.</p>
   </section>
  </div>
  <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
   <h3 className="flex items-center gap-2 font-bold text-amber-950"><AlertTriangle className="h-5 w-5"/>Critical recovery rules</h3>
   <p className="mt-2 text-sm leading-relaxed text-amber-950">Do not run Docker volume deletion, database reset, or any restoration directly over the working ARS database. If the operating database becomes damaged, stop new transactions, retain the original, and plan a verified cutover from an isolated restored copy.</p>
  </section>
  <section className="rounded-2xl border border-slate-200 bg-white p-5">
   <h3 className="font-bold">Daily operational checklist</h3>
   <div className="mt-3 space-y-3">
    <label className="flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={checks.external} onChange={e=>setChecks(v=>({...v,external:e.target.checked}))} className="mt-1 accent-amber-500"/>Latest database dump and SHA-256 file copied off this computer to encrypted storage.</label>
    <label className="flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={checks.isolated} onChange={e=>setChecks(v=>({...v,isolated:e.target.checked}))} className="mt-1 accent-amber-500"/>Latest backup successfully restored into an isolated test database and records checked.</label>
   </div>
   <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600"/>These checkboxes are local reminders, not proof of a completed backup. No automatic restore or background scheduling is enabled.</p>
   {checks.external&&checks.isolated&&<p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle className="h-4 w-4"/>Both items manually marked complete. Confirm actual files and restored records independently.</p>}
  </section>
 </div>;
}
