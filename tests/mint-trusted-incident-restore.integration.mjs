import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile, copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectWriterLoss} from '../scripts/writer-loss-inspection.mjs';
import {recordWriterLossReview} from '../scripts/writer-loss-review.mjs';
import {inspectIncidentRestoreReceipt} from '../scripts/writer-loss-restore-receipt.mjs';

const container = process.argv[2];
if (process.platform !== 'linux' || process.getuid() === 0 ||
    process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    !/^[a-f0-9]{64}$/.test(container ?? '')) {
  throw Error('Run against the disposable PostgreSQL service on a GitHub-hosted Linux runner.');
}

const project = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'ars-signed-restore-ci-'));
const database = 'ars_incident_' + randomBytes(8).toString('hex');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (program, args, options = {}) => execFileSync(program, args, {timeout: 120000, ...options});
const docker = (...args) => run('docker', ['--host', 'unix:///var/run/docker.sock', 'exec', container, ...args]);
const psql = sql => docker('psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', sql);
const tables = ['products', 'customers', 'sales_transactions', 'sales_transaction_items', 'purchase_orders',
  'purchase_order_items', 'supplier_payments', 'customer_credit_payments'];
let created = false;

try {
  docker('createdb', '-U', 'postgres', database);
  created = true;
  psql(tables.map(table => `CREATE TABLE ${table}(id integer); INSERT INTO ${table} VALUES(1);`).join('\n') +
    '\nALTER TABLE customers ADD COLUMN credit_balance numeric; ALTER TABLE supplier_payments ADD COLUMN amount numeric;');
  const archive = 'ars-fixture-database-only.dump';
  const dump = docker('pg_dump', '-U', 'postgres', '-Fc', database);
  // A separate desktop home and runtime hold only synthetic incident evidence.
  const state = join(temporary, '.local', 'share', 'ars-hardware');
  const runtime = join(state, 'runtime');
  const backups = join(runtime, 'backups');
  await mkdir(backups, {recursive: true});
  await symlink(process.execPath, join(state, 'node'));
  await writeFile(join(backups, archive), dump);
  await writeFile(join(backups, archive + '.sha256'), hash(dump) + '  ' + archive);
  await writeFile(join(runtime, '.ars-writer-loss.json'), JSON.stringify({
    schema: 1, reason: 'writer-lease-lost', pid: 123, recordedAt: new Date().toISOString(), reconciliationRequired: true
  }));
  const {incidentDigest} = await inspectWriterLoss(runtime);
  const evidenceFolder = join(runtime, 'writer-loss-evidence', incidentDigest);
  await mkdir(evidenceFolder, {recursive: true});
  const evidence = {};
  for (const category of ['databaseIdentity', 'previousSession', 'recoverableBackup', 'invoices', 'payments', 'inventory', 'accounting']) {
    const binding = category === 'recoverableBackup' ? {archive, archiveSha256: hash(dump)} : {};
    const record = JSON.stringify({schema: 1, incidentDigest, category, ...binding});
    await writeFile(join(evidenceFolder, category + '.json'), record);
    evidence[category] = hash(record);
  }
  await recordWriterLossReview(runtime, evidence, 'RECORD INCIDENT REVIEW');

  const privateKey = join(temporary, 'fixture-private.pem');
  const publicKey = join(state, 'release-signing-public.pem');
  run('openssl', ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', privateKey]);
  run('openssl', ['pkey', '-in', privateKey, '-pubout', '-out', publicKey]);
  const payload = join(temporary, 'source.tar.gz');
  run('tar', ['--exclude=__pycache__', '-czf', payload, '-C', project, 'package.json', 'scripts']);
  const signed = join(temporary, 'signed-release');
  const {version} = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  run('python3', [join(project, 'scripts/sign-update-release.py'), '--platform', 'linux-mint', '--version', version,
    '--archive', payload, '--private-key', privateKey, '--public-key', publicKey, '--output', signed]);
  const retained = {
    'manifest.json': '.ars-release-manifest.json',
    'manifest.sig': '.ars-release-manifest.sig',
    'release.tar.gz': '.ars-release.tar.gz'
  };
  for (const [name, target] of Object.entries(retained)) {
    await copyFile(join(signed, name), join(signed, target));
  }
  await mkdir(join(signed, 'scripts'));
  await writeFile(join(signed, 'scripts', 'writer-loss-restore-runner.mjs'), 'throw Error("Mutable release runner executed");');

  run('/usr/bin/python3', ['-E', '-s', '-B', join(project, 'scripts/mint/run-trusted-incident-restore.py'),
    signed, '--confirmation', 'RUN ISOLATED INCIDENT RESTORE'],
  {env: {...process.env, HOME: temporary}, timeout: 300000, stdio: 'inherit'});
  const receipt = await inspectIncidentRestoreReceipt(runtime);
  assert.equal(receipt.state, 'restore-receipt-matched');
  assert.equal(receipt.startupAllowed, false);
  assert.equal(psql('SELECT sum(id) FROM products;').toString().trim(), '1');
  assert.equal((await inspectWriterLoss(runtime)).incidentDigest, incidentDigest);
} finally {
  try {
    if (created) docker('dropdb', '-U', 'postgres', database);
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}
