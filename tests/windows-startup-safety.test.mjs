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

test('Windows autostart requires consent and protects other installation shortcuts',()=>{
 const s=readFileSync(new URL('../scripts/configure-windows-startup.ps1',import.meta.url),'utf8');
 assert.match(s,/GetFolderPath\('Startup'\)/);
 assert.match(s,/A different startup shortcut already exists/);
 assert.match(s,/\$answer -ne 'Yes'/);
 assert.match(s,/Remove-Item -LiteralPath \$path/);
 assert.doesNotMatch(s,/Register-ScheduledTask|docker compose|Set-Content/);
});

test('Windows shutdown entry points refuse indiscriminate process or database termination',()=>{
 const stop=readFileSync(new URL('../scripts/stop-local.ps1',import.meta.url),'utf8');
 const bat=readFileSync(new URL('../Stop-Hardware-POS.bat',import.meta.url),'utf8');
 const vbs=readFileSync(new URL('../Stop-Hardware-POS.vbs',import.meta.url),'utf8');
 assert.match(stop,/Port 3000 is still listening/);
 assert.match(stop,/PostgreSQL was left running/);
 assert.match(stop,/ARSDistributorPOSLauncher/);
 for(const source of [stop,bat,vbs])assert.doesNotMatch(source,/taskkill|Stop-Process|docker compose (down|stop)/i);
 assert.match(bat,/scripts\/stop-local\.ps1/);
 assert.match(vbs,/scripts\/stop-local\.ps1 -DesktopLaunch/);
});

test('Windows release inspection verifies independent trust and archive checksum without installation',()=>{
 const s=readFileSync(new URL('../scripts/inspect-windows-release.ps1',import.meta.url),'utf8');
 assert.match(s,/release-signing-public\.pem/);
 assert.match(s,/dgst -sha256 -verify/);
 assert.match(s,/Get-FileHash/);
 assert.match(s,/platform -cne 'windows'/);
 assert.match(s,/Release archive checksum mismatch/);
 assert.doesNotMatch(s,/Expand-Archive|npm\.cmd|docker compose|Invoke-Expression/);
});

test('Windows staging rejects unsafe ZIP members and publishes only to a new release directory',()=>{
 const s=readFileSync(new URL('../scripts/expand-windows-release.ps1',import.meta.url),'utf8');
 assert.match(s,/Unsafe or prohibited release path/);
 assert.match(s,/OrdinalIgnoreCase/);
 assert.match(s,/Duplicate release path/);
 assert.match(s,/Archive expanded beyond declared size/);
 assert.match(s,/FileMode\]::CreateNew/);
 const inspector=readFileSync(new URL('../scripts/inspect-windows-release.ps1',import.meta.url),'utf8');
 assert.match(inspector,/\[IO.Directory\]::Move\(\$pending,\$target\)/);
 assert.match(inspector,/No build, database connection or installation/);
});

test('Windows staged source revalidation uses signed original archive',()=>{
 const s=readFileSync(new URL('../scripts/verify-windows-staged-release.ps1',import.meta.url),'utf8');
 assert.match(s,/dgst -sha256 -verify/);
 assert.match(s,/Staged source file count mismatch/);
 assert.match(s,/ReparsePoint/);
 assert.match(s,/Staged source mismatch/);
 assert.doesNotMatch(s,/docker compose/);
});

test('Windows preparation compiles freshly verified source with a restricted process environment',()=>{
 const s=readFileSync(new URL('../scripts/verify-windows-staged-release.ps1',import.meta.url),'utf8');
 assert.match(s,/Copy-Item -LiteralPath \$clean -Destination \$pending/);
 assert.match(s,/\$answer -cne 'PREPARE'/);
 assert.match(s,/ci --include=dev --ignore-scripts/);
 assert.match(s,/NPM_CONFIG_USERCONFIG/);
 assert.match(s,/--check dist\/server\.cjs/);
 assert.match(s,/prepared-releases/);
 assert.doesNotMatch(s,/docker compose|Start-Process.*server\.cjs/);
});

test('Windows preflight backup is retained independently and never authorizes activation',()=>{
 const s=readFileSync(new URL('../scripts/prepare-windows-update-backup.ps1',import.meta.url),'utf8');
 assert.match(s,/Assert-ArsPreparedFingerprint/);
 assert.match(s,/backup-local-postgres\.ps1/);
 assert.match(s,/verify-backup\.mjs/);
 assert.match(s,/activationApproved=\$false/);
 assert.match(s,/restoreTestPassed=\$false/);
 assert.match(s,/quiesced=\$false/);
 assert.doesNotMatch(s,/docker compose|Remove-Item|Stop-Process/);
});

test('Windows update rehearsal uses unique isolated restore database and records no activation approval',()=>{
 const s=readFileSync(new URL('../scripts/rehearse-windows-update-restore.ps1',import.meta.url),'utf8');
 assert.match(s,/ars_restore_test_/);
 assert.match(s,/restore-local-postgres-test\.ps1/);
 assert.match(s,/Archive changed during restore rehearsal/);
 assert.match(s,/compatibilityTestPassed=\$false/);
 assert.match(s,/activationApproved=\$false/);
 assert.match(s,/FileMode\]::CreateNew/);
 assert.doesNotMatch(s,/DROP DATABASE|docker compose|Stop-Process/);
});

test('Windows offline rehearsal uses disconnected disposable PostgreSQL without host port or production mounts',()=>{
 const s=readFileSync(new URL('../scripts/rehearse-windows-update-container.ps1',import.meta.url),'utf8');
 assert.match(s,/'--network','none'/);
 assert.match(s,/'--pull=never'/);
 assert.match(s,/'--tmpfs'/);
 assert.match(s,/compatibilityTestPassed=\$false/);
 assert.match(s,/activationApproved=\$false/);
 assert.doesNotMatch(s,/'--publish'|docker compose/);
});

test('Windows candidate readiness requires pinned Linux dependencies and disconnected test network',()=>{
 const s=readFileSync(new URL('../scripts/rehearse-windows-update-container.ps1',import.meta.url),'utf8');
 assert.match(s,/Dependency image identity mismatch/);
 assert.match(s,/ars-lock-sha256/);
 assert.match(s,/'--network',\('container:'\+\$name\)/);
 assert.match(s,/target=\/app\/dist,readonly/);
 assert.match(s,/candidateStartupPassed=\$startupPassed/);
 assert.match(s,/compatibilityTestPassed=\$false/);
});

test('Windows candidate startup preserves existing table projections and row fingerprints',()=>{
 const s=readFileSync(new URL('../scripts/rehearse-windows-update-container.ps1',import.meta.url),'utf8');
 assert.equal((s.match(/\$evidence=\[ordered\]/g)||[]).length,1);
 assert.match(s,/Get-TestSchema/);
 assert.match(s,/Get-TestRowFingerprints/);
 assert.match(s,/set -o pipefail/);
 assert.match(s,/Historical records changed during startup/);
 assert.match(s,/historicalRowsCompared=\$historicalRowsCompared/);
 assert.match(s,/activationApproved=\$false/);
});

test('Windows candidate executes the trusted authenticated read probe only inside disposable containers',()=>{
 const s=readFileSync(new URL('../scripts/rehearse-windows-update-container.ps1',import.meta.url),'utf8');
 assert.match(s,/@example\.invalid/);
 assert.match(s,/compatibility-api-probe\.mjs/);
 assert.match(s,/DELETE FROM auth_sessions WHERE user_id=/);
 assert.match(s,/authenticatedReadsPassed=\$authenticatedReadsPassed/);
 assert.match(s,/activationApproved=\$false/);
 assert.ok(s.indexOf('INSERT INTO users')<s.indexOf('$historicalBefore='));
});

test('Windows candidate transaction probe runs after preservation comparison and only with disposable write opt-in',()=>{
 const s=readFileSync(new URL('../scripts/rehearse-windows-update-container.ps1',import.meta.url),'utf8');
 const probe=readFileSync(new URL('../scripts/mint/compatibility-write-probe.mjs',import.meta.url),'utf8');
 assert.ok(s.indexOf('$historicalRowsCompared=$true')<s.indexOf('mint/compatibility-write-probe.mjs'));
 assert.match(s,/ARS_TEST_ALLOW_WRITES=isolated-disposable/);
 assert.match(s,/authenticatedWritesPassed=\$authenticatedWritesPassed/);
 assert.match(s,/activationApproved=\$false/);
 assert.match(probe,/createRequire\('\/app\/package\.json'\)/);
 assert.match(probe,/assert\.equal\(url\.pathname,'\/ars_update_test'\)/);
});
