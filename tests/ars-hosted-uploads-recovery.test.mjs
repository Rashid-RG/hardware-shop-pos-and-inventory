import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Git on Windows may check out shell scripts with CRLF. Assert their logic independently of line endings.
const smoke = readFileSync(new URL('../scripts/verify-hosted-container-ci.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('hosted uploads recovery drill is restricted to disposable GitHub CI resources', () => {
  assert.match(smoke, /GITHUB_ACTIONS:-.*CI:-/s);
  assert.match(smoke, /hardware_pos_hosted_smoke_ci/);
  assert.match(smoke, /Refusing to reuse an existing Docker upload or restore volume/);
  assert.match(smoke, /created_volume=false/);
  assert.match(smoke, /created_restore_volume=false/);
  assert.match(smoke, /if \[\[ "\$created_volume" == "true" \]\]/);
  assert.match(smoke, /if \[\[ "\$created_restore_volume" == "true" \]\]/);
});

test('uploaded logos and product images must restore independently with byte-identical hashes', () => {
  assert.match(smoke, /tar -C \/source -cf - shops products/);
  assert.match(smoke, /tar -C \/restore -xf -/);
  assert.match(smoke, /source=\$restore_volume,target=\/restore/);
  assert.match(smoke, /sha256sum shops\/ci-smoke-file\.txt products\/ci-product-file\.txt/);
  assert.match(smoke, /original_hashes.*restored_hashes/);
  assert.match(smoke, /Restored upload files differ/);
  assert.match(smoke, /start_container\nwait_ready\ncurl -fsS --max-time 5 "http:\/\/127\.0\.0\.1:\$port\/uploads\/products/);
});
