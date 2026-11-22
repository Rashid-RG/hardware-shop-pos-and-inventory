import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
const brand = readFileSync(new URL('../src/components/ARSBrand.tsx', import.meta.url), 'utf8');

test('anonymous branch lookup does not disclose configured business details', () => {
  const publicHandler = server.split("app.get('/api/public/shops'")[1]?.split("app.use('/api', requireAuth)")[0] || '';
  assert.match(publicHandler, /status\(401\)/);
  assert.doesNotMatch(publicHandler, /db\.settings|db\.users|shop\.address|shop\.phone|shop\.name/);
});

test('login never fetches or lists registered shops before authentication', () => {
  assert.doesNotMatch(app, /fetch\(`?\/api\/public\/shops/);
  assert.doesNotMatch(app, /loginShops|loginShopId|resetShopId/);
  assert.match(app, /Your authorized branch will load after verification/);
});

test('ARS company mark is distinct and visible in the login and sidebar', () => {
  assert.match(sidebar, /<ARSBrand/);
  assert.match(app, /<ARSBrand featured/);
  assert.match(brand, /ARS Hardware/);
  assert.match(brand, /ARS <span/);
  assert.match(sidebar, /RS Nextward/);
});
