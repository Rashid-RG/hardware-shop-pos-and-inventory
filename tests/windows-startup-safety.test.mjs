import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const launcher = readFileSync(new URL('../scripts/start-local.ps1', import.meta.url), 'utf8');
const config = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const docker = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');

test('Windows launcher never kills unrelated processes on occupied port 3000', () => {
  assert.match(launcher, /Port 3000 is already in use/);
  assert.doesNotMatch(launcher, /Stop-Process\s+-Id\s+\$portProcess/);
  assert.doesNotMatch(launcher, /Stop-Process\s+-Id\s+\$portProcess\s+-Force/);
});
test('Windows sample configuration uses mapped PostgreSQL host port', () => {
  assert.match(config, /127\.0\.0\.1:5433\/hardware_pos/);
  assert.match(docker, /5433:5432/);
});
test('Windows startup validates a strong session secret and PostgreSQL without demo role passwords', () => {
  assert.match(launcher, /\$jwtValue\.Length -lt 32/);
  assert.match(launcher, /Test-PostgresAuth \$dbUrl/);
  assert.doesNotMatch(launcher, /\$requiredPasswords = @\('ADMIN_PASSWORD'/);
  assert.doesNotMatch(launcher, /Configure a unique password/);
  assert.match(launcher, /Employee credentials are managed in PostgreSQL/);
});
test('Windows startup avoids launching Docker for unreachable remote PostgreSQL', () => {
  assert.match(launcher, /Configured remote PostgreSQL is not reachable/);
  assert.match(launcher, /Database connection verified/);
});

test('Windows desktop starts prepared production build on loopback, not dev server', () => {
  assert.match(launcher, /Test-Path 'dist\/server\.cjs' -PathType Leaf/);
  assert.match(launcher, /Test-Path 'dist\/index\.html' -PathType Leaf/);
  assert.match(launcher, /\$env:NODE_ENV = 'production'/);
  assert.match(launcher, /\$env:ARS_LISTEN_HOST = '127\.0\.0\.1'/);
  assert.match(launcher, /-ArgumentList 'dist\/server\.cjs'/);
  assert.doesNotMatch(launcher, /-ArgumentList '[^']*npm run dev/);
});

test('Windows fresh setup refuses existing configuration and does not initialize a database',()=>{
 const setup=readFileSync(new URL('../scripts/setup-windows.ps1',import.meta.url),'utf8');
 assert.match(setup,/Existing configuration detected/);
 assert.match(setup,/An existing build was found/);
 assert.match(setup,/npm\.cmd run build/);
 assert.match(setup,/CreateShortcut/);
 assert.doesNotMatch(setup,/docker compose (up|down)|Remove-Item|Copy-Item/);
});
