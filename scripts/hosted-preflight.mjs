import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export function validateHostedConfiguration(env = process.env, options = {}) {
  const issues = [];
  if (env.NODE_ENV !== 'production') issues.push('NODE_ENV must be production for hosted mode.');
  const secret = String(env.JWT_SECRET || '').trim();
  if (secret.length < 32 || /(change.?me|replace.?with|example|password)/i.test(secret)) {
    issues.push('JWT_SECRET must be a strong non-placeholder secret of at least 32 characters.');
  }
  let parsed;
  try {
    parsed = new URL(String(env.DATABASE_URL || ''));
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
      issues.push('DATABASE_URL must be an explicit PostgreSQL connection URL.');
    }
    if (parsed.pathname === '/hardware_pos_ci') issues.push('Refusing the isolated CI database for hosted usage.');
  } catch {
    issues.push('DATABASE_URL must be configured in the host secret store.');
  }
  if (env.ARS_DISABLE_HTTP_FIRST_ADMIN_SETUP !== 'true') {
    issues.push('ARS_DISABLE_HTTP_FIRST_ADMIN_SETUP=true is required behind a hosted reverse proxy.');
  }
  if (env.ARS_UPLOADS_MOUNT_REQUIRED !== 'true') {
    issues.push('ARS_UPLOADS_MOUNT_REQUIRED=true is required for the production container.');
  }
  if (!String(env.ARS_RELEASE_ID || '').trim()) {
    issues.push('ARS_RELEASE_ID is required to identify the approved release.');
  }
  if (!options.skipFilesystemCheck) {
    const root = resolve(options.uploadsDir || 'uploads');
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      issues.push('Persistent uploads directory is missing.');
    } else {
      // Linux containers: verify an actual bind/volume mount instead of the
      // container's ephemeral writable layer. Some hosts expose mount paths
      // in /proc/self/mountinfo with octal escaped spaces.
      const mountsPath = options.mountsPath || '/proc/self/mountinfo';
      if (!existsSync(mountsPath)) {
        issues.push('Cannot verify uploads mount; production must run on a Linux host with mountinfo.');
      } else {
        const mountPaths = readFileSync(mountsPath, 'utf8').split('\n').map(line => {
          const columns = line.split(' ');
          return (columns[4] || '').replace(/\\040/g, ' ').replace(/\\011/g, '\t');
        });
        if (!mountPaths.includes(root)) {
          issues.push('Uploads folder is not a dedicated persistent mounted volume.');
        }
      }
      const probe = resolve(root, '.ars-preflight-' + randomBytes(8).toString('hex'));
      try {
        writeFileSync(probe, 'ARS mount write check', { flag: 'wx', mode: 0o600 });
        unlinkSync(probe);
      } catch {
        issues.push('Uploads directory is not writable by the application user.');
      }
    }
  }
  return issues;
}

if (process.argv[1] && import.meta.url === new URL('file://' + resolve(process.argv[1])).href) {
  const issues = validateHostedConfiguration();
  if (issues.length) {
    for (const issue of issues) console.error('ARS hosted preflight: ' + issue);
    process.exitCode = 1;
  } else {
    console.log('ARS hosted preflight passed: production configuration and uploads mount verified.');
  }
}
