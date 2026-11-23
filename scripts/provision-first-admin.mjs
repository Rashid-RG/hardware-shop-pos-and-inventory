import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';

export const validateFirstAdmin = ({ name, email, password }) => {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (cleanName.length < 2 || cleanName.length > 100) throw new Error('Administrator name must be 2–100 characters.');
  if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Enter a valid administrator email address.');
  }
  if (cleanPassword.length < 12 || cleanPassword.length > 128 || /(change.?me|password|example)/i.test(cleanPassword)) {
    throw new Error('Administrator password must be 12–128 characters and cannot contain placeholder words.');
  }
  return { name: cleanName, email: cleanEmail, password: cleanPassword };
};

// Uses exactly the same one-time transaction advisory lock as the localhost
// /api/auth/setup-admin route. Never resets tables, seeds sample users, or
// overwrites an existing account. The current process must be restarted after
// first-admin creation to reload its legacy in-memory login snapshot.
export async function provisionFirstAdmin(client, user) {
  const { name, email, password } = validateFirstAdmin(user);
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [5412927]);
    const existing = await client.query('SELECT 1 FROM users LIMIT 1');
    if (existing.rowCount) throw new Error('First administrator already exists. Use normal account management; no changes were made.');
    const id = 'usr-' + email.replace(/[^a-z0-9]+/g, '-');
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      "INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, 'Super Admin', $4)",
      [id, email, name, passwordHash],
    );
    await client.query('COMMIT');
    return { created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function secretPrompt(label) {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) throw new Error('Interactive host console required. Passwords via flags or pipes are refused.');
  stdout.write(label);
  const chars = [];
  stdin.setRawMode(true);
  stdin.resume();
  try {
    for await (const chunk of stdin) {
      for (const character of String(chunk)) {
        if (character === '\r' || character === '\n') {
          stdout.write('\n');
          return chars.join('');
        }
        if (character === '\u0003') throw new Error('Cancelled by operator.');
        if (character === '\u007f' || character === '\b') {
          chars.pop();
        } else if (character >= ' ' && chars.length < 128) {
          chars.push(character);
        }
      }
    }
    throw new Error('Interactive input closed.');
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

async function run() {
  if (process.env.ARS_ALLOW_FIRST_ADMIN_BOOTSTRAP !== 'true') {
    throw new Error('First-admin console setup disabled. Set ARS_ALLOW_FIRST_ADMIN_BOOTSTRAP=true only for the one-time approved operation.');
  }
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Requires a local interactive terminal; no non-interactive secrets or command line passwords.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be provided by the host secret store.');
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: stdin, output: stdout });
  let name, email;
  try {
    name = await rl.question('First administrator name: ');
    email = await rl.question('Administrator email: ');
  } finally {
    rl.close();
  }
  const password = await secretPrompt('Password (input hidden): ');
  const confirmation = await secretPrompt('Confirm password (input hidden): ');
  if (password !== confirmation) throw new Error('Passwords do not match. No account was created.');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await provisionFirstAdmin(client, { name, email, password });
    stdout.write('First administrator created. Remove the bootstrap flag and restart the ARS server before signing in.\n');
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + resolve(process.argv[1])).href) {
  run().catch(error => {
    console.error('ARS admin setup refused: ' + (error instanceof Error ? error.message : 'Unknown error'));
    process.exitCode = 1;
  });
}
