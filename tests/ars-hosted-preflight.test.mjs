import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateHostedConfiguration } from '../scripts/hosted-preflight.mjs';

const good = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:secret@db.example.internal:5432/ars_stage',
  JWT_SECRET: 'ARS-test-only-secret-with-more-than-32-characters',
  ARS_DISABLE_HTTP_FIRST_ADMIN_SETUP: 'true',
  ARS_UPLOADS_MOUNT_REQUIRED: 'true',
  ARS_RELEASE_ID: 'ci-abc123',
};

test('hosted setup rejects missing or placeholder credentials and release ID', () => {
  const errors = validateHostedConfiguration({ ...good, JWT_SECRET: 'replace_with_test_password', ARS_RELEASE_ID: '' }, { skipFilesystemCheck: true });
  assert.match(errors.join(' '), /JWT_SECRET/);
  assert.match(errors.join(' '), /ARS_RELEASE_ID/);
});

test('hosted setup cannot point at the CI database and requires a declared upload mount', () => {
  const errors = validateHostedConfiguration({ ...good, DATABASE_URL: 'postgresql://ci@localhost/hardware_pos_ci', ARS_UPLOADS_MOUNT_REQUIRED: 'false' }, { skipFilesystemCheck: true });
  assert.match(errors.join(' '), /CI database/);
  assert.match(errors.join(' '), /ARS_UPLOADS_MOUNT_REQUIRED/);
});

test('hosted setup refuses an HTTP first-admin setup exposed by a reverse proxy', () => {
  const errors = validateHostedConfiguration({ ...good, ARS_DISABLE_HTTP_FIRST_ADMIN_SETUP: 'false' }, { skipFilesystemCheck: true });
  assert.match(errors.join(' '), /ARS_DISABLE_HTTP_FIRST_ADMIN_SETUP/);
});

test('hosted setup rejects an ordinary local folder as an ephemeral uploads store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ars-uploads-check-'));
  const mountInfo = join(dir, 'mountinfo');
  try {
    writeFileSync(mountInfo, '36 25 0:32 / / rw,relatime - overlay overlay rw\n');
    const errors = validateHostedConfiguration(good, { uploadsDir: dir, mountsPath: mountInfo });
    assert.match(errors.join(' '), /dedicated persistent mounted volume/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hosted setup accepts a writable directory explicitly shown as a mount', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ars-uploads-valid-'));
  const mountInfo = join(dir, 'mountinfo');
  try {
    writeFileSync(mountInfo, `42 25 0:53 / ${dir} rw,relatime - ext4 /dev/mock rw\n`);
    assert.deepEqual(validateHostedConfiguration(good, { uploadsDir: dir, mountsPath: mountInfo }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
