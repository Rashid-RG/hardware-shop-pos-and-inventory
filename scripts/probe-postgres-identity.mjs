// Read-only host-side identity probe. No secrets or connection diagnostics on stdout.
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
const sql = "SELECT system_identifier::text || ':' || (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS identity FROM pg_control_system()";
async function main() {
  const config = dotenv.parse(readFileSync(process.argv[2]));
  const url = new URL(config.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.port !== '5433' || url.pathname !== '/hardware_pos' || url.search || url.hash ||
      !url.username || !url.password) throw new Error('Unsupported database configuration');
  // Explicit fields avoid connection-string options or inherited PG* variables changing the target.
  const client = new pg.Client({
    host: url.hostname === '[::1]' ? '::1' : url.hostname, port: 5433,
    database: 'hardware_pos', user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), ssl: false,
    connectionTimeoutMillis: 5000, query_timeout: 5000,
    options: '-c default_transaction_read_only=on',
  });
  try {
    await client.connect();
    const result = await client.query(sql);
    const identity = result.rows[0]?.identity;
    if (result.rowCount !== 1 || !/^[0-9]{1,20}:[0-9]{1,10}$/.test(identity ?? '')) throw new Error('Invalid identity');
    process.stdout.write(identity + '\n');
  } finally { await client.end(); }
}
main().catch(() => { process.stderr.write('PostgreSQL identity verification failed.\n'); process.exitCode = 1; });
