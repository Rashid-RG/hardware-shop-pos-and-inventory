import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../scripts/preview-windows-stable-launcher.ps1',import.meta.url),'utf8');
test('stable launcher preview is non-activating and resolves only a prepared version',()=>{
  assert.match(source,/launcher-preview\.json/);
  assert.match(source,/Assert-ArsPreparedFingerprint \$release/);
  assert.match(source,/Join-Path \$releases \$p\.version/);
  assert.match(source,/activationAllowed=\$false;startupAllowed=\$false;schedulingAllowed=\$false/);
  assert.doesNotMatch(source,/\b(Start-Process|Set-Content|New-Item|Remove-Item|Register-ScheduledTask|docker compose)\b/i);
});
test('stable launcher preview shares maintenance mutex and rejects reparse points',()=>{
  assert.match(source,/Local\\ARSDistributorPOSLauncher/);
  assert.match(source,/ReparsePoint/);
  assert.match(source,/maintenance\.json.*activation\.json.*instance\.json/);
  assert.match(source,/finally[\s\S]*ReleaseMutex/);
});
