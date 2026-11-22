import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pg from 'pg';

// A conscious, local-only recovery action. Not called by application startup.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(root, '.env.local') });
const url = new URL(String(process.env.DATABASE_URL || ''));
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('Refusing to reset administrator credentials on a nonlocal database.');
}
if (!url.pathname || url.pathname === '/') {
  throw new Error('The target database name must be explicit.');
}
if (!process.stdin.isTTY && process.argv.includes('--interactive-only')) {
  throw new Error('Unexpected noninteractive invocation.');
}
let payload = '';
for await (const chunk of process.stdin) {
  payload += chunk.toString();
  if (payload.length > 1200) throw new Error('Oversized recovery input.');
}
const input = JSON.parse(payload);
const email = String(input.email || '').trim().toLowerCase();
const password = String(input.password || '');
const confirmation = String(input.confirmation || '');
if (confirmation !== 'RESET MY LOCAL ADMIN PASSWORD') throw new Error('Explicit recovery confirmation is required.');
if (!email || password.length < 12 || password.length > 128 ||
    /(change.?me|password|example)/i.test(password)) {
  throw new Error('Provide an existing administrator email and a new strong password (12-128 characters).');
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const existing = await client.query(
    'SELECT id FROM users WHERE lower(email) = $1 AND role = $2 LIMIT 1',
    [email, 'Super Admin'],
  );
  if (existing.rowCount !== 1) {
    throw new Error('That email is not an existing Super Admin. No accounts were changed.');
  }
  const hash = await bcrypt.hash(password, 12);
  await client.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [hash, existing.rows[0].id],
  );
  process.stdout.write('Administrator password updated in PostgreSQL. Restart the POS and sign in.\n');
} finally {
  await client.end().catch(() => {});
}
