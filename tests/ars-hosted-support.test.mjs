import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/components/SupportHealthPanel.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/components/AccountingSettingsView.tsx', import.meta.url), 'utf8');
const installer = readFileSync(new URL('../scripts/install-hosted-shortcut.ps1', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../docs/ars-hosted-installation-and-release.md', import.meta.url), 'utf8');

test('support diagnostics are read-only and only accessible after login to authorized managers', () => {
  const authPosition = server.indexOf("app.use('/api', requireAuth);");
  const supportPosition = server.indexOf("app.get('/api/support/diagnostics'");
  assert.ok(authPosition >= 0 && supportPosition > authPosition);
  assert.match(server, /app\.get\('\/api\/support\/diagnostics', requireRole\(\['Super Admin', 'Store Manager'\]\)/);
  const route = server.slice(supportPosition, server.indexOf("\n});", supportPosition));
  assert.match(route, /Cache-Control', 'no-store'/);
  assert.match(route, /pool\.query\('SELECT 1'\)/);
  for (const name of ['service', 'checkedAt', 'release', 'uptimeSeconds', 'database', 'writes', 'status']) {
    assert.ok(route.includes(name));
  }
  assert.doesNotMatch(route, /password|token|DATABASE_URL|req\.headers|db\.customers|db\.transactions|shopId/);
});

test('company profile exposes manual support check and never uploads collected personal data', () => {
  assert.match(settings, /<SupportHealthPanel authToken=\{authToken\}/);
  assert.match(settings, /\['Super Admin', 'Store Manager'\]\.includes\(currentRole\)/);
  assert.match(panel, /id="ars-run-health-check"/);
  assert.match(panel, /id="ars-copy-support-summary"/);
  assert.match(panel, /navigator\.clipboard\.writeText/);
  assert.match(panel, /fetch\('\/api\/support\/diagnostics'/);
  assert.doesNotMatch(panel, /method: 'POST'|sendBeacon|localStorage/);
});

test('Windows shortcut installs only a hosted HTTPS URL and refuses overwrite', () => {
  assert.match(installer, /parsedUrl\.Scheme -ne 'https'/);
  assert.match(installer, /Test-Path -LiteralPath \$shortcutPath/);
  assert.match(installer, /Shortcut already exists/);
  assert.match(installer, /\[InternetShortcut\]/);
  assert.doesNotMatch(installer, /npm ci|docker compose|DATABASE_URL/);
});

test('hosted release guide preserves one server and explicit owner approval', () => {
  assert.match(guide, /One application instance only/);
  assert.match(guide, /loopback/);
  assert.match(guide, /uploads/);
  assert.match(guide, /explicit release approval/);
  assert.match(guide, /Do not deploy with an uninitialized login flow/i);
});
