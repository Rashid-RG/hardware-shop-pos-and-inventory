import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const s=readFileSync(new URL('../scripts/start-local.ps1',import.meta.url),'utf8');
test('Windows startup resolves explicit runtime before configuration creation and fails closed before database operations',()=>{
  assert.match(s,/Get-ArsWindowsRuntimeRoot \(Get-Location\)\.Path/);
  assert.match(s,/Join-Path \$runtimeRoot '\.env\.local'/);
  assert.equal((s.match(/Get-Content -LiteralPath \$configPath/g)||[]).length,2);
  const gate=s.indexOf('External runtime startup is disabled');
  assert.ok(gate>0 && gate<s.indexOf("Copy-Item '.env.example'"));
  assert.ok(gate<s.indexOf('$dbUrl = Get-DatabaseUrlFromEnvFile'));
  assert.match(s,/function Try-StartDockerCompose \{\s+if \(\$externalRuntime\) \{ throw/);
});
