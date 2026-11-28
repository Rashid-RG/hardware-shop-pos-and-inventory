import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/preview-windows-docker-binding.ps1',import.meta.url),'utf8');
test('Docker binding preview checks context, Compose ownership, named volume and port without activating',()=>{
  for(const fragment of ['context','npipe://','com.docker.compose.project','com.docker.compose.service','com.docker.compose.volume','/var/lib/postgresql/data','hardware_pos_pgdata','5432/tcp','activationAllowed=$false','databaseIdentityVerified=$true']) assert.ok(s.includes(fragment),fragment);
  assert.doesNotMatch(s,/\b(Start-Process|Set-Content|New-Item|Remove-Item|Invoke-Expression)\b/i);
  assert.doesNotMatch(s,/docker\s+(compose|run|start|stop|rm)\b/i);
  assert.match(s,/finally[\s\S]*ReleaseMutex/);
});

test('identity preview compares container and host cluster identifiers without activation',()=>{
  const probe=readFileSync(new URL('../scripts/probe-postgres-identity.mjs',import.meta.url),'utf8');
  assert.match(s,/pg_control_system\(\)/);
  assert.match(s,/\$outside\[0\] -cne \$inside\[0\]/);
  assert.match(s,/State\.StartedAt -cne \$c\.State\.StartedAt/);
  assert.match(probe,/default_transaction_read_only=on/);
  assert.match(probe,/dotenv\.parse/);
  assert.match(probe,/pg_control_system\(\)/);
  assert.doesNotMatch(probe,/\b(INSERT INTO|UPDATE pg_|DELETE FROM|CREATE TABLE)\b/i);
});
