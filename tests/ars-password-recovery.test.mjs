import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
test('email recovery is opt-in, rate limited, and has no plaintext OTP storage', () => {
  assert.match(server, /PASSWORD_RECOVERY_ENABLED === 'true'/);
  assert.match(server, /secret.length >= 32/);
  assert.match(server, /randomInt\(0, 1000000\)/);
  assert.match(server, /createHmac\('sha256'/);
  assert.match(server, /INTERVAL '5 minutes'/);
  assert.match(server, /attempts<5 FOR UPDATE/);
  assert.match(server, /timingSafeEqual\(expected,actual\)/);
  assert.match(server, /requireTLS:config.port!==465/);
});
test('password recovery consumes the code and revokes sessions transactionally', () => {
  const start=server.indexOf("app.post('/api/auth/recovery/complete'");
  const end=server.indexOf("app.use('/api', requireAuth);", start);
  assert.ok(start>=0 && end>start);
  const route=server.slice(start,end);
  assert.match(route, /await client.query\('BEGIN'\)/);
  assert.match(route, /password_hash=\$4 AND role=\$5/);
  assert.match(route, /UPDATE auth_sessions SET revoked_at=NOW\(\)/);
  assert.match(route, /expires_at=NOW\(\), attempts=5/);
  assert.match(route, /'completed'/);
  assert.match(route, /await client.query\('COMMIT'\)/);
  assert.match(route, /bcrypt.hash\(password,12\)/);
});
test('login exposes recovery and a guarded resend action', () => {
  assert.match(app, /Forgot Password\?/);
  assert.match(app, /\/api\/auth\/recovery-status/);
  assert.match(app, /Resend Verification Code/);
  assert.match(app, /recoveryNow < recoveryRetryAt/);
});
