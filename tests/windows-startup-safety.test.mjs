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
test('Windows startup checks all logins, session secret and actual PostgreSQL authentication', () => {
  assert.match(launcher, /\$requiredPasswords = @\('ADMIN_PASSWORD'/);
  assert.match(launcher, /\$jwtValue\.Length -lt 32/);
  assert.match(launcher, /Every role must have a different password/);
  assert.match(launcher, /Test-PostgresAuth \$dbUrl/);
  assert.match(launcher, /Configure a unique password/);
});
test('Windows startup avoids launching Docker for unreachable remote PostgreSQL', () => {
  assert.match(launcher, /Configured remote PostgreSQL is not reachable/);
  assert.match(launcher, /Database connection verified/);
});
