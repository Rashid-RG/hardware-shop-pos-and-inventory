import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// A missing directory is normal for fresh installations. Any existing marker,
// including malformed or unreadable evidence, blocks ordinary startup.
export function assertNoMaintenanceEvidence(directory: string, names: readonly string[]) {
  for (const name of names) {
    try {
      fs.lstatSync(path.join(directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error('Maintenance evidence cannot be inspected. Startup blocked.');
    }
    throw new Error('Unresolved maintenance evidence. Startup blocked.');
  }
}
export function assertOrdinaryStartupAllowed() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA;
    if (!base || !path.isAbsolute(base)) throw new Error('Local maintenance location unavailable. Startup blocked.');
    assertNoMaintenanceEvidence(path.join(base, 'RS Nextward', 'ARS Distributor', 'desktop-control'), [
      'maintenance.json', 'maintenance-shutdown.json', 'activation.json', 'handoff-pending.json',
      'runtime-switch-intent.json', 'runtime-switch-journal.json', 'runtime-active.json', 'repair-interrupted.json',
    ]);
  } else if (process.platform === 'linux') {
    assertNoMaintenanceEvidence(path.join(os.homedir(), '.local', 'share', 'ars-hardware'), [
      'maintenance-hold.json', 'handoff-pending.json', 'runtime-switch-intent.json',
      'runtime-migration-interrupted.json', 'runtime-activation-interrupted.json', 'switch-journal.json', 'repair-interrupted.json',
    ]);
  }
}

// Runtime-local incident evidence follows the business storage, not the release.
// Existing or partial evidence is never overwritten.
export function assertNoWriterLoss(runtimeRoot: string) {
  assertNoMaintenanceEvidence(runtimeRoot, ['.ars-writer-loss.json']);
}
export function recordWriterLoss(runtimeRoot: string) {
  const target = path.join(runtimeRoot, '.ars-writer-loss.json');
  let fd: number;
  try { fd = fs.openSync(target, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({schema:1,reason:'writer-lease-lost',recordedAt:new Date().toISOString(),pid:process.pid,reconciliationRequired:true})+'\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (process.platform !== 'win32') {
    const dir = fs.openSync(runtimeRoot, 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
}
