import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/preview-windows-docker-binding.ps1',import.meta.url),'utf8');
test('Docker binding preview checks context, Compose ownership, named volume and port without activating',()=>{
  for(const fragment of ['context','npipe://','com.docker.compose.project','com.docker.compose.service','com.docker.compose.volume','/var/lib/postgresql/data','hardware_pos_pgdata','5432/tcp','activationAllowed=$false','databaseIdentityVerified=$false']) assert.ok(s.includes(fragment),fragment);
  assert.doesNotMatch(s,/\b(Start-Process|Set-Content|New-Item|Remove-Item|Invoke-Expression)\b/i);
  assert.doesNotMatch(s,/docker\s+(compose|run|start|stop|exec|rm)\b/i);
  assert.match(s,/finally[\s\S]*ReleaseMutex/);
});
