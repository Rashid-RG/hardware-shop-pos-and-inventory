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
    ]);
  } else if (process.platform === 'linux') {
    assertNoMaintenanceEvidence(path.join(os.homedir(), '.local', 'share', 'ars-hardware'), [
      'maintenance-hold.json', 'handoff-pending.json',
    ]);
  }
}
