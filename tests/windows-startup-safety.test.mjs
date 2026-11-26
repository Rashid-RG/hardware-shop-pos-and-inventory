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
