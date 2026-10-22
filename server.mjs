// HRSystem Dashboard: a small dashboard (health, speed, versions, backups, update, SQL) for the HRSystem installations.
// It runs on the owner's PC only (127.0.0.1) and has no npm dependencies. Start it with Menaxheri.bat.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The port is chosen by the system (port 0 = any free port) in an installation; MANAGER_PORT forces one, and on a development PC it is 3500.
const PORT_FORCED = process.env.MANAGER_PORT ? Number(process.env.MANAGER_PORT) : null;
const CONFIG = path.join(HERE, fs.existsSync(path.join(HERE, 'instances.json')) ? 'instances.json' : 'instances.example.json');
// Sign-in key: OPTIONAL (owner, 2026-10-21: the dashboard is installed locally and opens with no sign-in). It is asked for only
// when manager/dashboard.key exists (or DASHBOARD_KEY is set), e.g. on a shared computer where other users could open it.
const KEY_FILE = path.join(HERE, 'dashboard.key');
function dashboardKey() {
  if (process.env.DASHBOARD_KEY) return process.env.DASHBOARD_KEY;
  return fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '';
}
let LOGIN_KEY = dashboardKey();
let COOKIE = crypto.createHash('sha256').update('dashboard:' + LOGIN_KEY).digest('hex');
let SIGN_IN = LOGIN_KEY.length > 0;
const sameText = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const authed = (req) => { if (!SIGN_IN) return true; const m = /(?:^|;\s*)mgr=([0-9a-f]+)/.exec(req.headers.cookie || ''); return !!m && sameText(m[1], COOKIE); };
let failures = []; // times of wrong keys: 5 in a minute locks the sign-in for a minute
const LOGIN_HTML = '<!doctype html><html lang="sq"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HRSystem Dashboard</title><style>:root{color-scheme:light dark}body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}form{display:grid;gap:12px;width:min(320px,90vw)}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #8886}button{background:#2457d6;color:#fff;border:0;font-weight:600;cursor:pointer}p{margin:0;font-size:13px;opacity:.75}#e{color:#c0392b;min-height:18px}</style></head><body><form id="f"><h1 style="margin:0;font-size:20px">HRSystem Dashboard</h1><input id="k" type="password" autocomplete="off" placeholder="Fjalekalimi i dashboard-it" autofocus required><button>Hyr</button><p>Harrove fjalekalimin? Fshi skedarin manager\\dashboard.key (vetem administratori).</p><p id="e"></p></form><script>f.onsubmit=async function(ev){ev.preventDefault();const r=await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:k.value})});if(r.ok)location.reload();else e.textContent=r.status===429?"Shume provime. Prit nje minute.":"Fjalekalimi nuk eshte i sakte."};var h=/[#&]key=([0-9a-f]+)/.exec(location.hash);if(h){history.replaceState(null,"",location.pathname);k.value=h[1];f.requestSubmit()}</script></body></html>';

// A random key per run: every action that changes something (backup) must carry it, so a web page cannot trigger it.
const SESSION_KEY = crypto.randomBytes(24).toString('hex');
const BOOT_ID = crypto.createHash('sha256').update(SESSION_KEY).digest('hex').slice(0, 10); // shown to the page, not the key itself
// A broken connection or an error in one request must never stop the dashboard: it is logged and the dashboard keeps running.
process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.stack ? e.stack : e));
const history = new Map(); // instance id -> last speed samples (ms, 0 = down)

// Only what runs on THIS PC (owner, 2026-10-21): the folders listed in the config that exist here, plus the standard install
// C:\HRSystem when it is found. Other hosts (Hostinger, VPS, other computers) are not shown.
function instances() {
  // The list file is optional: an installation needs none (C:\HRSystem is found by itself); a missing or broken file means an empty list.
  let configured = [];
  try { configured = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).instances || []; } catch { /* no list file */ }
  const listed = configured.filter((i) => i.root && fs.existsSync(path.join(i.root, 'current.txt')));
  // The installation this dashboard belongs to is the folder above manager/ (C:\HRSystem by default; its data folder is <that folder>Data).
  const std = path.dirname(HERE);
  if (fs.existsSync(path.join(std, 'current.txt')) && !listed.some((i) => i.root.toLowerCase() === std.toLowerCase())) {
    const upd = (() => { try { return JSON.parse(fs.readFileSync(path.join(std, 'update.json'), 'utf8')); } catch { return {}; } })();
    listed.unshift({ id: 'hrsystem', name: 'HRSystem (ky PC)', root: std, data: std + 'Data', repo: upd.repo, channel: upd.channel || 'stable', task: 'HRSystem' });
  }
  return listed.map((i) => {
    let env = {};
    try { env = readEnv(path.join(i.root, '.env')); } catch { /* no .env */ }
    return { ...i, url: i.url || env.APP_ORIGIN || '', local: `http://127.0.0.1:${env.PORT || 3000}` };
  });
}
const find = (id) => instances().find((i) => i.id === id);

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const run = (file, args, env = {}, cwd = undefined) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { env: { ...process.env, ...env }, cwd, windowsHide: true, timeout: 20 * 60 * 1000 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()),
    ),
  );

async function health(inst) {
  const samples = [];
  let status = 0;
  let body = null;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(inst.local + '/api/health', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
      samples.push(Math.round(performance.now() - t0));
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
  }
  samples.sort((a, b) => a - b);
  const ms = samples.length ? samples[Math.floor(samples.length / 2)] : 0;
  const ok = status === 200 && !!body && body.ok === true;
  const h = history.get(inst.id) || [];
  h.push(ok ? Math.max(1, ms) : null); // null = down; a sub-millisecond answer is shown as 1 ms, not as down
  history.set(inst.id, h.slice(-24));
  return { ok, status, ms: ok ? Math.max(1, ms) : 0, database: body?.database ?? null, history: history.get(inst.id) };
}

// The read-only GitHub token: the installation's own (encrypted file, read by its hr-common.ps1), else GITHUB_TOKEN, else the signed-in gh.
const tokens = new Map();
async function token(inst) {
  const key = inst.root || '';
  if (tokens.has(key)) return tokens.get(key);
  let t = process.env.GITHUB_TOKEN || '';
  const common = inst.root && path.join(inst.root, 'hr-common.ps1');
  if (!t && common && fs.existsSync(common)) {
    t = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `. '${common.replace(/'/g, "''")}'; Get-GitHubToken`], { HRSYSTEM_ROOT: inst.root, HRSYSTEM_DATA: inst.data || '' }).catch(() => '');
  }
  if (!t) t = await run('gh', ['auth', 'token']).catch(() => '');
  tokens.set(key, t.trim());
  return tokens.get(key);
}

async function latest(inst) {
  if (!inst.repo) return null;
  const t = await token(inst);
  const res = await fetch(`https://api.github.com/repos/${inst.repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'regina-manager', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return { error: `GitHub ${res.status}` };
  const releases = (await res.json()).filter((r) => !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name));
  const pick = inst.channel === 'test' ? releases[0] : releases.find((r) => !r.prerelease);
  if (!pick) return { error: 'Nuk ka Release' };
  const asset = pick.assets.find((a) => a.name.endsWith('-Hostinger.zip'));
  return {
    version: pick.tag_name.slice(1),
    prerelease: pick.prerelease,
    published: pick.published_at,
    build: asset ? `${asset.id}:${asset.updated_at}` : null,
  };
}

// A local installation keeps the active release in current.txt and the build it came from in releases/<name>/.asset.
function installed(inst) {
  if (!inst.root) return null;
  try {
    const name = fs.readFileSync(path.join(inst.root, 'current.txt'), 'utf8').trim();
    let build = null;
    try { build = fs.readFileSync(path.join(inst.root, 'releases', name, '.asset'), 'utf8').trim(); } catch { /* none */ }
    return { name, version: name.replace(/-b\d+$/, ''), build };
  } catch {
    return { error: 'current.txt nuk u gjet' };
  }
}

const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

function backupDir(inst) {
  return inst.data ? path.join(inst.data, 'Backups') : null;
}

function listBackups(inst) {
  const dir = backupDir(inst);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, time: st.mtime.toISOString() }; })
    .sort((a, b) => b.time.localeCompare(a.time));
}

function mysqldumpPath() {
  const base = 'C:\\Program Files\\MySQL';
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base).sort().reverse()) {
      const p = path.join(base, d, 'bin', 'mysqldump.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return 'mysqldump';
}

async function backup(inst) {
  try { return await backupRaw(inst); } catch (e) { addHistory(inst, { title: 'Backup', ok: false, detail: String(e.message).slice(0, 160) }); notify(inst, 'Backup-i dështoi', String(e.message).slice(0, 160)); throw e; }
}
async function backupRaw(inst) {
  if (!inst.root || !inst.data) throw new Error('Ky instalim nuk ndodhet ne kete kompjuter: backup-in e bën nga paneli i hostit.');
  const cfg = readEnv(path.join(inst.root, '.env'));
  const dir = backupDir(inst);
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; // local time, like the updater's backups
  const file = path.join(dir, `${/^[A-Za-z][A-Za-z0-9_]*$/.test(cfg.DB_NAME || '') ? cfg.DB_NAME : 'hrsystem'}-${stamp}.sql`); // <database name>-<date>-<time>.sql
  await run(
    mysqldumpPath(),
    [`--user=${cfg.DB_USER}`, '--protocol=TCP', `--host=${cfg.DB_HOST}`, `--port=${cfg.DB_PORT}`, '--single-transaction', '--no-tablespaces', '--hex-blob', '--default-character-set=utf8mb4', `--result-file=${file}`, cfg.DB_NAME],
    { MYSQL_PWD: cfg.DB_PASSWORD },
  );
  noteBackupVersion(inst, path.basename(file));
  addHistory(inst, { title: 'Backup', ok: true, detail: path.basename(file) });
  syncOffsite(inst).catch(() => {});
  return { name: path.basename(file), size: fs.statSync(file).size };
}

// Which version of the program was running when a backup was made (owner, 2026-10-22). A backup made here (manual, night, safety copy) records the
// installed version at once; the updater's own backups are matched by time against a log of version changes that the dashboard keeps.
function recordVersion(inst) {
  const i = installed(inst);
  if (!i || i.error) return;
  const cur = readSettings(inst), log = Array.isArray(cur.versionLog) ? cur.versionLog : [];
  if (log.length && log[log.length - 1].name === i.name) return;
  log.push({ at: Date.now(), name: i.name });
  cur.versionLog = log.slice(-60);
  try { fs.writeFileSync(settingsFile(inst), JSON.stringify(cur, null, 2)); } catch { /* read-only folder */ }
}
function noteBackupVersion(inst, file) {
  const i = installed(inst);
  if (!i || i.error) return;
  const cur = readSettings(inst);
  cur.backupVersions = { ...(cur.backupVersions || {}), [file]: i.name };
  const keys = Object.keys(cur.backupVersions); if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete cur.backupVersions[k];
  try { fs.writeFileSync(settingsFile(inst), JSON.stringify(cur, null, 2)); } catch { /* read-only folder */ }
}
function withVersions(inst, list) {
  const cur = readSettings(inst), known = cur.backupVersions || {}, log = Array.isArray(cur.versionLog) ? cur.versionLog : [];
  return list.map((b) => {
    let v = known[b.name] || null;
    if (!v) { const t = Date.parse(b.time); for (const e of log) if (e.at <= t) v = e.name; }
    return { ...b, version: v };
  });
}
setInterval(() => { for (const inst of instances()) { if (inst.root) { try { recordVersion(inst); } catch { /* next time */ } } } }, 60000).unref();

// ---- Jobs (update, SQL): run in the background, the page polls their output ----
const jobs = new Map(); // instance id -> { title, state: 'running' | 'ok' | 'error', lines, started }
const clean = (t) => t.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');

function startJob(inst, title, launch) {
  const old = jobs.get(inst.id);
  if (old && old.state === 'running') throw new Error('Nje veprim po ekzekutohet: "' + old.title + '". Prit te mbaroje.');
  const job = { title, state: 'running', lines: [], started: Date.now() };
  jobs.set(inst.id, job);
  const add = (t) => { for (const l of clean(String(t)).split('\n')) if (l.trim()) job.lines.push(l); job.lines = job.lines.slice(-200); };
  Promise.resolve()
    .then(() => launch(add))
    .then((ok) => { job.state = ok === false ? 'error' : 'ok'; job.ended = Date.now(); try { jobDone(inst, job); } catch { /* history only */ } })
    .catch((e) => { add('GABIM: ' + e.message); job.state = 'error'; job.ended = Date.now(); try { jobDone(inst, job); } catch { /* history only */ } });
  return job;
}

function needLocal(inst) {
  if (!inst.root || !inst.data) throw new Error('Ky instalim nuk ndodhet ne kete kompjuter.');
}

// The update is the installation's own updater.ps1 (backup, build, migrations, health check, automatic return).
function spawnUpdater(inst, add, zip) {
  const script = path.join(inst.root, 'updater.ps1');
  if (!fs.existsSync(script)) throw new Error('updater.ps1 nuk u gjet te ' + inst.root);
  return new Promise((resolve) => {
    const env = { ...process.env, HRSYSTEM_ROOT: inst.root, HRSYSTEM_DATA: inst.data };
    if (inst.task) env.HRSYSTEM_TASK = inst.task;
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...(zip ? ['-Zip', zip] : [])], { env, windowsHide: true });
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    p.on('error', (e) => { add('GABIM: ' + e.message); resolve(false); });
    p.on('close', (code) => resolve(code === 0));
  });
}
function runUpdate(inst) {
  needLocal(inst);
  if (!fs.existsSync(path.join(inst.root, 'updater.ps1'))) throw new Error('updater.ps1 nuk u gjet te ' + inst.root);
  return startJob(inst, 'Perditesim', (add) => spawnUpdater(inst, add));
}

// ---- Go back to an older version of the program (owner, 2026-10-22) ----
// The backup holds only the database; the program (code, forms, design) is the version in releases\<name>\ (kept locally) or the Release on GitHub.
// Going back to a version that is on this PC just switches current.txt and restarts the app (no build); one that is only on GitHub is downloaded and
// installed with the same updater (update.bat <zip>: backup, build, migrations, health check). Afterwards the version is PINNED: the automatic
// night update and the "new version" notice ignore what GitHub had at that moment, and only a version NEWER than that (or "Hiq ngjitjen")
// ends the pin, so the old version does not come straight back.
function pinOf(inst) { return readSettings(inst).pinned || null; }
function savePin(inst, pin) {
  const cur = readSettings(inst);
  if (pin) cur.pinned = pin; else delete cur.pinned;
  try { fs.writeFileSync(settingsFile(inst), JSON.stringify(cur, null, 2)); } catch { /* read-only folder */ }
}
function updateKindPinned(inst, i, l) {
  const pin = pinOf(inst);
  if (pin && i && !i.error) {
    if (i.name !== pin.name) savePin(inst, null); // another version was installed since (by hand): the pin is over
    else if (l && !l.error && cmp(l.version, pin.seen) > 0) savePin(inst, null); // GitHub has a newer version than the one the owner went back from
    else return null;
  }
  return updateKind(i, l);
}
async function pinNow(inst) {
  const i = installed(inst);
  if (!i || i.error) return;
  const l = await latestCached(inst).catch(() => null);
  savePin(inst, { name: i.name, version: i.version, seen: l && !l.error ? l.version : i.version, at: new Date().toISOString() });
}
function localVersions(inst) {
  const dir = path.join(inst.root, 'releases');
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'dist', 'index.html'))).map((d) => d.name).sort(); } catch { return []; }
}
async function repoReleases(inst) {
  if (!inst.repo) return [];
  const t = await token(inst);
  const res = await fetch(`https://api.github.com/repos/${inst.repo}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'regina-manager', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('GitHub ' + res.status);
  return (await res.json()).filter((r) => !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name)).map((r) => {
    const a = r.assets.find((x) => x.name.endsWith('-Hostinger.zip'));
    return a ? { version: r.tag_name.slice(1), prerelease: r.prerelease, url: a.url, name: a.name, size: a.size } : null;
  }).filter(Boolean);
}
async function versionsOf(inst) {
  needLocal(inst);
  const cur = installed(inst);
  let repo = [], repoError = null;
  try { repo = (await repoReleases(inst)).map(({ version, prerelease }) => ({ version, prerelease })); } catch (e) { repoError = e.message; }
  return { current: cur && cur.name, local: localVersions(inst), repo, repoError, pinned: pinOf(inst) };
}
function rollbackLocal(inst, name, withBackup) {
  needLocal(inst);
  const bk = withBackup ? backupText(inst, withBackup) : null;
  if (!localVersions(inst).includes(name)) throw new Error('Ky version nuk ndodhet në këtë PC.');
  const cur = installed(inst);
  if (cur && cur.name === name) throw new Error('Ky version është tashmë aktiv.');
  const common = path.join(inst.root, 'hr-common.ps1');
  return startJob(inst, 'Rikthim i versionit', async (add) => {
    add('Po kalohet te versioni ' + name + ' (pa build: kodi është tashmë në këtë PC)...');
    const script = `. ${q(common)}; $ErrorActionPreference = 'Stop'; $cfg = Use-HrEnv; $port = [int]$cfg['PORT']; if (-not $port) { $port = 3000 }; $old = Get-InstalledVersion; ` +
      `Set-Content -Path $script:CurrentFile -Value ${q(name)} -NoNewline; Restart-HrApp; ` +
      `if (Wait-Health $port 60) { 'OK' } else { Set-Content -Path $script:CurrentFile -Value $old -NoNewline; Restart-HrApp; Wait-Health $port 60 | Out-Null; 'FAIL' }`;
    const out = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { HRSYSTEM_ROOT: inst.root, HRSYSTEM_DATA: inst.data || '' });
    if (!/OK\s*$/.test(out.trim())) { add('Versioni ' + name + ' nuk u përgjigj: u kthye versioni i mëparshëm.'); return false; }
    await pinNow(inst);
    add('Aplikacioni punon me versionin ' + name + '. Përditësimet automatike janë ndalur deri në një version më të ri në GitHub.');
    if (bk) { add('Po rikthehet edhe databaza nga ' + bk.name + '...'); await importSteps(inst, bk.name, bk.text, add); }
    return true;
  });
}
function rollbackRepo(inst, version, withBackup) {
  needLocal(inst);
  const bk = withBackup ? backupText(inst, withBackup) : null;
  return startJob(inst, 'Rikthim i versionit', async (add) => {
    const rel = (await repoReleases(inst)).find((r) => r.version === version);
    if (!rel) throw new Error('Versioni ' + version + ' nuk u gjet te GitHub.');
    const t = await token(inst);
    add('Po shkarkohet ' + rel.name + ' (' + Math.round(rel.size / 1048576) + ' MB)...');
    const r = await fetch(rel.url, { headers: { Accept: 'application/octet-stream', 'User-Agent': 'regina-manager', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, redirect: 'follow' });
    if (!r.ok) throw new Error('Shkarkimi dështoi (GitHub ' + r.status + ').');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length !== rel.size) throw new Error('Shkarkimi nuk u plotësua (madhësia nuk përputhet).');
    const zip = path.join(os.tmpdir(), 'rollback-' + rel.name);
    fs.writeFileSync(zip, buf);
    try {
      const ok = await spawnUpdater(inst, add, zip);
      if (ok) { await pinNow(inst); add('Përditësimet automatike janë ndalur deri në një version më të ri në GitHub.'); }
      if (ok && bk) { add('Po rikthehet edhe databaza nga ' + bk.name + '...'); await importSteps(inst, bk.name, bk.text, add); }
      return ok;
    } finally { fs.rmSync(zip, { force: true }); }
  });
}

function mysqlPath() { return mysqldumpPath().replace(/mysqldump(\.exe)?$/, 'mysql$1'); }

function mysqlRun(inst, cfg, sqlFile, add) {
  return new Promise((resolve, reject) => {
    const p = spawn(mysqlPath(), [`--user=${cfg.DB_USER}`, '--protocol=TCP', `--host=${cfg.DB_HOST}`, `--port=${cfg.DB_PORT}`, '--default-character-set=utf8mb4', cfg.DB_NAME], { env: { ...process.env, MYSQL_PWD: cfg.DB_PASSWORD }, windowsHide: true });
    let err = '';
    p.stdout.on('data', add);
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(clean(err).trim() || 'mysql perfundoi me kod ' + code))));
    p.stdin.on('error', () => { /* mysql stopped reading (an error in the file): its own message is shown, the dashboard must not crash */ });
    fs.createReadStream(sqlFile).pipe(p.stdin);
  });
}

// Replace the whole database with a dump (e.g. from Hostinger's phpMyAdmin): backup, drop the tables, load the dump, then run the
// migrations the dump does not have yet (the installed release's own migrate-cli). The backup is the way back.
function runImport(inst, name, text) {
  needLocal(inst);
  return startJob(inst, 'Import databaze: ' + name, (add) => importSteps(inst, name, text, add));
}
async function importSteps(inst, name, text, add) {
  const cfg = readEnv(path.join(inst.root, '.env'));
  const dir = path.join(inst.data, 'Backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const dropFile = path.join(dir, `drop-${stamp}.tmp.sql`);
  const dumpFile = path.join(dir, `import-${stamp}.tmp.sql`);
  // MariaDB 11.4+ names a collation MySQL 8.4 does not know; the standard one is the same for this app.
  fs.writeFileSync(dumpFile, text.replace(/utf8mb4_uca1400_[a-z_]+/g, 'utf8mb4_unicode_ci').replace(/^\s*(CREATE DATABASE|USE)\b.*$/gim, '-- (skipped) $&'));
  {
    try {
      add('1/4 Backup i databazes para importit...');
      const b = await backup(inst);
      add('Backup: ' + b.name + ' (kthimi mbrapa)');
      add('2/4 Po fshihen tabelat ekzistuese...');
      const tables = (await run(mysqlPath(), [`--user=${cfg.DB_USER}`, '--protocol=TCP', `--host=${cfg.DB_HOST}`, `--port=${cfg.DB_PORT}`, '-N', '-B', '-e', 'SHOW FULL TABLES WHERE Table_type="BASE TABLE"', cfg.DB_NAME], { MYSQL_PWD: cfg.DB_PASSWORD })).split(/\r?\n/).map((l) => l.split('\t')[0]).filter(Boolean);
      fs.writeFileSync(dropFile, 'SET FOREIGN_KEY_CHECKS=0;\n' + tables.map((t) => 'DROP TABLE IF EXISTS `' + t.replace(/`/g, '``') + '`;').join('\n') + '\nSET FOREIGN_KEY_CHECKS=1;\n');
      await mysqlRun(inst, cfg, dropFile, add);
      add('3/4 Po ngarkohet ' + name + ' ...');
      await mysqlRun(inst, cfg, dumpFile, add);
      add('4/4 Migrimet qe mungojne...');
      const release = fs.readFileSync(path.join(inst.root, 'current.txt'), 'utf8').trim();
      const relDir = path.join(inst.root, 'releases', release);
      add(await run(process.execPath, ['server/core/migrate-cli.mjs'], cfg, relDir));
      add('SUKSES: databaza u importua.');
    } catch (e) {
      add('Nese databaza ka mbetur gjysme, rikthe backup-in e mesiperm (Ekzekuto SQL ose sql-import.bat).');
      throw e;
    } finally {
      fs.rmSync(dropFile, { force: true });
      fs.rmSync(dumpFile, { force: true });
    }
  }
}
// The backup to put back together with a version (optional): only a file of the backup list.
function backupText(inst, name) {
  const found = name && listBackups(inst).find((b) => b.name === name);
  if (!found) throw new Error('Backup-i nuk u gjet.');
  return { name: found.name, text: fs.readFileSync(path.join(backupDir(inst), found.name), 'utf8') };
}

// One .sql file: backup first, then run it; it stops at the first error.
function runSql(inst, name, text) {
  needLocal(inst);
  const cfg = readEnv(path.join(inst.root, '.env'));
  const tmp = path.join(inst.data, 'Backups', 'sql-' + Date.now() + '.tmp.sql');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, text);
  return startJob(inst, 'SQL: ' + name, async (add) => {
    try {
      add('Backup i databazes para SQL...');
      const b = await backup(inst);
      add('Backup: ' + b.name);
      add('Po ekzekutohet ' + name + ' ...');
      await new Promise((resolve, reject) => {
        const p = spawn(mysqlPath(), [`--user=${cfg.DB_USER}`, '--protocol=TCP', `--host=${cfg.DB_HOST}`, `--port=${cfg.DB_PORT}`, '--default-character-set=utf8mb4', cfg.DB_NAME], { env: { ...process.env, MYSQL_PWD: cfg.DB_PASSWORD }, windowsHide: true });
        let err = '';
        p.stdout.on('data', add);
        p.stderr.on('data', (d) => { err += d; });
        p.on('error', reject);
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(clean(err).trim() || 'mysql perfundoi me kod ' + code))));
        p.stdin.on('error', () => { /* same as above */ });
        fs.createReadStream(tmp).pipe(p.stdin);
      });
      add('SUKSES: SQL u ekzekutua.');
    } catch (e) {
      add('Backup-i para SQL ruhet; asgje tjeter nuk u ndryshua pas gabimit.');
      throw e;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
}

// ---- Where everything is (shown in the dashboard) and what can be done with the system ----
function readTextOr(file, fallback = '') { try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; } }

function pathsOf(inst, env) {
  const release = readTextOr(path.join(inst.root, 'current.txt')).trim();
  let mysqlData = path.join(inst.data, 'MySQLData');
  for (const ini of ['mysql-hrsystem.ini', 'my.ini']) {
    const m = /^datadir=(.*)$/mi.exec(readTextOr(path.join(inst.root, ini)));
    if (m) { mysqlData = path.normalize(m[1].trim()); break; }
  }
  const list = [
    { key: 'root', label: 'Folderi kryesor (aplikacioni, skriptet)', path: inst.root },
    ...(release ? [{ key: 'release', label: 'Kodi qe po punon (versioni ' + release + ')', path: path.join(inst.root, 'releases', release) }] : []),
    { key: 'env', label: 'Cilesimet (.env: porta, databaza, adresa)', path: path.join(inst.root, '.env'), file: true },
    { key: 'launcher', label: 'Nisesi i aplikacionit (start-hrsystem.ps1)', path: path.join(inst.root, 'start-hrsystem.ps1'), file: true },
    { key: 'data', label: 'Te dhenat (databaza, backup-et)', path: inst.data },
    { key: 'mysql', label: 'Skedaret e databazes MySQL', path: mysqlData },
    { key: 'backups', label: 'Backup-et e databazes', path: path.join(inst.data, 'Backups') },
  ];
  const logDirs = [inst.root, path.join(inst.root, 'logs')];
  for (const dir of logDirs) {
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.log')) list.push({ key: 'log:' + path.join(dir, f), label: 'Log: ' + f, path: path.join(dir, f), file: true });
    } catch { /* no such folder */ }
  }
  return list.map((e) => ({ ...e, exists: fs.existsSync(e.path) }));
}

// The public address (domain) is set once from the dashboard and kept in dashboard-settings.json in the installation folder.
const settingsFile = (inst) => path.join(inst.root, 'dashboard-settings.json');
function readSettings(inst) { try { return JSON.parse(fs.readFileSync(settingsFile(inst), 'utf8')); } catch { return {}; } }
function normalizeDomain(raw) {
  let d = String(raw || '').trim();
  if (!d) return '';
  if (!/^https?:[/][/]/i.test(d)) d = 'https://' + d;
  const m = /^(https?:[/][/][A-Za-z0-9.-]+(?::[0-9]+)?)(?:[/].*)?$/i.exec(d);
  if (!m) throw new Error('Adresa nuk duket e sakte (p.sh. https://staff.butikuregina.com).');
  return m[1].toLowerCase();
}

// The names the application is opened with from the internet are found by themselves: the application remembers the address of its last
// request that came through the tunnel (GET /api/local/public-host); the dashboard asks for it every few seconds and keeps every name it
// sees with the time (domainsSeen). One tunnel can carry several names (self, app, test ...), so all of them are shown. A name not seen
// for 14 days is forgotten; a temporary address (quick tunnel) is never a domain of the application.
async function learnDomains(inst) {
  try {
    const rawSeen = (await (await fetch(inst.local + '/api/local/public-host', { signal: AbortSignal.timeout(3000), cache: 'no-store' })).json()).host || '';
    let seen = '';
    try { seen = rawSeen ? normalizeDomain(rawSeen) : ''; } catch { /* not a plain host name: ignored */ }
    if (/[.]trycloudflare[.]com$/i.test(seen)) seen = '';
    const settings = readSettings(inst);
    const known = settings.domainsSeen && typeof settings.domainsSeen === 'object' ? { ...settings.domainsSeen } : {};
    const oldOne = settings.domainSeen && !/[.]trycloudflare[.]com$/i.test(settings.domainSeen) ? settings.domainSeen : '';
    if (oldOne && !known[oldOne]) known[oldOne] = new Date().toISOString();
    if (seen) known[seen] = new Date().toISOString();
    for (const [h, at] of Object.entries(known)) if (Date.now() - Date.parse(at) > 14 * 864e5) delete known[h];
    if (JSON.stringify(known) !== JSON.stringify(settings.domainsSeen) || settings.domainSeen !== undefined || settings.domain !== undefined) {
      settings.domainsSeen = known; delete settings.domainSeen; delete settings.domain; // a domain typed by hand is no longer used (owner, 2026-10-22: only automatic)
      fs.writeFileSync(settingsFile(inst), JSON.stringify(settings, null, 2));
    }
  } catch { /* older application without the route, or it is stopped */ }
}
setInterval(() => { try { for (const inst of instances()) if (inst.local && inst.root) learnDomains(inst); } catch { /* none */ } }, 15000).unref();

const domainHealth = new Map(); // url -> { at, ok }
const tunnelSeen = { at: 0, list: '' }; // the list of cloudflared processes, 10 s
async function accessOf(inst, env) {
  const settings = readSettings(inst);
  const isPublic = (o) => o && !o.includes('localhost') && !o.includes('127.0.0.1');
  // Only automatic: the names that were seen (in alphabetical order), then the one from the .env.
  const names = [...Object.keys(settings.domainsSeen || {}).sort(), env.APP_ORIGIN].filter(isPublic).filter((o, i, all) => all.indexOf(o) === i);
  const domains = await Promise.all(names.map(async (u) => {
    let ok = false;
    const seen = domainHealth.get(u);
    if (seen && Date.now() - seen.at < 45000) return { url: u, ok: seen.ok };
    try { ok = (await fetch(u.replace(/[/]$/, '') + '/api/health', { signal: AbortSignal.timeout(5000), cache: 'no-store' })).ok; } catch { ok = false; }
    domainHealth.set(u, { at: Date.now(), ok });
    return { url: u, ok };
  }));
  // A name learned from the tunnel that no longer opens (the tunnel or its DNS record was deleted) is forgotten at once; only the one in
  // .env stays listed when it does not open.
  const learned = settings.domainsSeen || {};
  const gone = domains.filter((d) => !d.ok && learned[d.url] && d.url !== env.APP_ORIGIN).map((d) => d.url);
  if (gone.length) {
    const cur = readSettings(inst);
    for (const g of gone) delete (cur.domainsSeen || {})[g];
    try { fs.writeFileSync(settingsFile(inst), JSON.stringify(cur, null, 2)); } catch { /* read-only folder */ }
    domains.splice(0, domains.length, ...domains.filter((d) => !gone.includes(d.url)));
  }
  const publicDomain = domains.length ? domains[0].url : '';
  const domainOk = domains.length ? domains[0].ok : null;
  // A permanent tunnel is any cloudflared process except the temporary one (its pid is in quick-tunnel.json), which is not "the tunnel".
  const quickPid = (quickState(inst) || {}).pid;
  if (Date.now() - tunnelSeen.at > 10000) { tunnelSeen.list = await run('tasklist', ['/FI', 'IMAGENAME eq cloudflared.exe', '/NH', '/FO', 'CSV']).catch(() => ''); tunnelSeen.at = Date.now(); }
  const tunnel = tunnelSeen.list.split(/\r?\n/).some((l) => /^"cloudflared[.]exe","(\d+)"/i.test(l) && Number(/^"[^"]*","(\d+)"/.exec(l)[1]) !== quickPid);
  // tunnelOk: a cloudflared process runs AND at least one of the names opens (a deleted tunnel keeps its process but nothing opens).
  return { local: 'http://localhost:' + (env.PORT || 3000), domain: publicDomain, domainOk, domains, tunnel, tunnelOk: tunnel && domains.some((d) => d.ok), quickUrl: quickUrlOf(inst) };
}

const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";
// Stop / start / restart the application of an installation (its Task Scheduler task; the node process is ended by its folder).
async function systemAction(inst, action) {
  needLocal(inst);
  const task = inst.task || 'HRSystem';
  const stop = `Stop-ScheduledTask -TaskName ${q(task)} -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like ${q('*' + inst.root + '*server.mjs*')} -and $_.CommandLine -notlike '*\manager\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  const start = `Start-ScheduledTask -TaskName ${q(task)}`;
  const command = action === 'stop' ? stop : action === 'start' ? start : action === 'restart' ? `${stop}; Start-Sleep -Seconds 2; ${start}` : null;
  if (!command) throw new Error('Veprim i panjohur.');
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
  return { ok: true };
}

// The Cloudflare Tunnel (opens the application from the internet with the owner's own address): the same steps as the installer.
function runTunnel(inst, rawToken) {
  needLocal(inst);
  const token = String(rawToken || '').replace(/^.*service\s+install\s+/i, '').trim().replace(/^["']|["']$/g, '');
  if (token.length < 20 || /\s/.test(token)) throw new Error('Tokeni i Cloudflare nuk duket i sakte (ngjite sic e jep Cloudflare).');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$cf = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source",
    "if (-not $cf) { foreach ($p in @($env:HR_CF1, $env:HR_CF2)) { if (Test-Path $p) { $cf = $p } } }",
    "if (-not $cf) { Write-Host 'cloudflared mungon: po instalohet...'; winget install --id Cloudflare.cloudflared -e --source winget --accept-package-agreements --accept-source-agreements --silent; foreach ($p in @($env:HR_CF1, $env:HR_CF2)) { if (Test-Path $p) { $cf = $p } } }",
    "if (-not $cf) { throw 'cloudflared.exe nuk u gjet (winget nuk e instaloi).' }",
    "if (Get-Service cloudflared -ErrorAction SilentlyContinue) { Stop-Service cloudflared -Force -ErrorAction SilentlyContinue; & $cf service uninstall; Start-Sleep -Seconds 2 }",
    "Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne [int]$env:HR_QUICK_PID } | Stop-Process -Force -ErrorAction SilentlyContinue",
    "& $cf service install $env:HR_TUNNEL_TOKEN",
    "if ($LASTEXITCODE -ne 0) { throw 'cloudflared service install deshtoi.' }",
    "Start-Sleep -Seconds 3; Set-Service cloudflared -StartupType Automatic; if ((Get-Service cloudflared).Status -ne 'Running') { Start-Service cloudflared }",
    "Write-Host 'SUKSES: Cloudflare Tunnel u lidh dhe niset vete me Windows.'",
  ].join('; ');
  return startJob(inst, 'Cloudflare Tunnel', (add) => new Promise((resolve) => {
    const env = { ...process.env, HR_QUICK_PID: String((quickState(inst) || {}).pid || 0), HR_TUNNEL_TOKEN: token, HR_CF1: path.join(process.env.ProgramFiles || '', 'cloudflared', 'cloudflared.exe'), HR_CF2: path.join(process.env['ProgramFiles(x86)'] || '', 'cloudflared', 'cloudflared.exe') };
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { env, windowsHide: true });
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    p.on('error', (e) => { add('GABIM: ' + e.message); resolve(false); });
    p.on('close', (code) => resolve(code === 0));
  }));
}

// Remove the permanent tunnel from this PC: the Windows service (if any) and every cloudflared process except the temporary address.
function removeTunnel(inst) {
  needLocal(inst);
  const script = [
    "$cf = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source",
    "if (-not $cf) { foreach ($p in @($env:HR_CF1, $env:HR_CF2)) { if (Test-Path $p) { $cf = $p } } }",
    "if ((Get-Service cloudflared -ErrorAction SilentlyContinue) -and $cf) { Stop-Service cloudflared -Force -ErrorAction SilentlyContinue; & $cf service uninstall }",
    "Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne [int]$env:HR_QUICK_PID } | Stop-Process -Force -ErrorAction SilentlyContinue",
    "Write-Host 'SUKSES: tuneli u hoq nga ky PC.'",
  ].join('; ');
  return startJob(inst, 'Heqja e tunelit', (add) => new Promise((resolve) => {
    const env = { ...process.env, HR_QUICK_PID: String((quickState(inst) || {}).pid || 0), HR_CF1: path.join(process.env.ProgramFiles || '', 'cloudflared', 'cloudflared.exe'), HR_CF2: path.join(process.env['ProgramFiles(x86)'] || '', 'cloudflared', 'cloudflared.exe') };
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { env, windowsHide: true });
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    p.on('error', (e) => { add('GABIM: ' + e.message); resolve(false); });
    p.on('close', (code) => resolve(code === 0));
  }));
}

// A temporary public address (a Cloudflare "quick tunnel": https://<words>.trycloudflare.com): no account and no domain of the owner's
// needed, it works while the process runs and is a new address every time. For trying the application from a phone (some operators
// do not let a new domain through; this one opened on mobile data, owner 2026-10-22).
// The tunnel is a separate process that outlives the dashboard (a restart or an update of the dashboard does not end it): its process id and
// address are kept in quick-tunnel.json in the installation folder. "quickWanted" (dashboard-settings.json) remembers that the owner switched
// it on: when the process is gone (restart of the PC) the dashboard starts a new one, with a new address (an account-less tunnel never keeps one).
function cloudflaredPath() {
  const names = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((p) => path.join(p, 'cloudflared', 'cloudflared.exe'));
  return names.find((p) => fs.existsSync(p)) || null;
}
const quickFile = (inst) => path.join(inst.root, 'quick-tunnel.json');
function quickState(inst) {
  try { const j = JSON.parse(fs.readFileSync(quickFile(inst), 'utf8')); process.kill(j.pid, 0); return j.url ? j : null; } catch { return null; }
}
const quickUrlOf = (inst) => (quickState(inst) || {}).url || '';
function setQuickWanted(inst, on) {
  const cur = readSettings(inst);
  if (on) cur.quickWanted = true; else delete cur.quickWanted;
  try { fs.writeFileSync(settingsFile(inst), JSON.stringify(cur, null, 2)); } catch { /* read-only folder */ }
}
let quickStarting = false;
async function startQuick(inst) {
  needLocal(inst);
  const live = quickState(inst);
  if (live) { setQuickWanted(inst, true); return { url: live.url }; }
  if (quickStarting) throw new Error('Adresa e përkohshme po krijohet, prit pak.');
  const exe = cloudflaredPath();
  if (!exe) throw new Error('cloudflared mungon: instaloje me "Lidh me internetin" (tokeni) ose me winget install Cloudflare.cloudflared.');
  quickStarting = true;
  try {
    let env = {};
    try { env = readEnv(path.join(inst.root, '.env')); } catch { /* defaults */ }
    const log = path.join(inst.root, 'quick-tunnel.log');
    try { fs.rmSync(log, { force: true }); } catch { /* in use */ }
    const proc = spawn(exe, ['tunnel', '--no-autoupdate', '--url', 'http://localhost:' + (env.PORT || 3000), '--logfile', log], { detached: true, stdio: 'ignore', windowsHide: true });
    proc.unref();
    let url = '';
    for (let i = 0; i < 40 && !url; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try { const m = /https:[/][/][a-z0-9-]+[.]trycloudflare[.]com/.exec(fs.readFileSync(log, 'utf8')); if (m) url = m[0]; } catch { /* not written yet */ }
    }
    if (!url) { try { process.kill(proc.pid); } catch { /* gone */ } throw new Error('Adresa e përkohshme nuk u krijua (kontrollo internetin).'); }
    fs.writeFileSync(quickFile(inst), JSON.stringify({ pid: proc.pid, url }));
    setQuickWanted(inst, true);
    return { url };
  } finally { quickStarting = false; }
}
function stopQuick(inst) {
  try { const j = JSON.parse(fs.readFileSync(quickFile(inst), 'utf8')); process.kill(j.pid); } catch { /* not running */ }
  try { fs.rmSync(quickFile(inst), { force: true }); } catch { /* gone */ }
  setQuickWanted(inst, false);
  return { ok: true };
}
setInterval(() => {
  try { for (const inst of instances()) if (inst.root && readSettings(inst).quickWanted && !quickState(inst) && !quickStarting) startQuick(inst).catch(() => {}); } catch { /* next round */ }
}, 20000).unref();

// The dashboard updates itself from its own PUBLIC GitHub repo (owner, 2026-10-22): one repo for every installation, no token needed. The files
// of its main branch are compared with the local ones by their git blob hash. A new version is downloaded and applied by itself (every 10
// minutes, and from the "Përditëso dashboard-in" button); the old files are kept in manager/.previous/, server.mjs is written last (its change
// makes the dashboard start itself again) and a guard process puts the old files back when the new dashboard does not answer within 25 s.
// Only an installed dashboard updates; only files that already exist here are replaced.
const DASH_REPO = process.env.DASHBOARD_REPO || 'rogestshalaa/HRSystem-Dashboard';
const gitBlobSha = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex');
async function ghJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hrsystem-dashboard' }, signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (!res.ok) throw new Error('GitHub ' + res.status);
  return res.json();
}
const dashSafe = (rel) => { const full = path.resolve(HERE, rel); return full.startsWith(HERE + path.sep) && !rel.startsWith('.previous') ? full : null; };
// Besides manager/ the repo keeps root/<name>: the PowerShell scripts of the installation root (the updater kills the dashboard unless it has
// the fixed hr-common.ps1), updated in the same way. Only these names, and only when the file already exists in the installation root.
const ROOT_FILES = new Set(['hr-common.ps1', 'updater.ps1', 'sql-import.ps1']);
const localPathOf = (rel) => (rel.startsWith('root/') ? (ROOT_FILES.has(rel.slice(5)) ? path.join(path.dirname(HERE), rel.slice(5)) : null) : dashSafe(rel));
async function dashboardDiff() {
  const tree = await ghJson(`https://api.github.com/repos/${DASH_REPO}/git/trees/main?recursive=1`);
  const changed = [];
  for (const e of tree.tree || []) {
    if (e.type !== 'blob' || !localPathOf(e.path) || /^(instances|dashboard)[.](json|key)$/.test(e.path)) continue;
    let local = null;
    try { local = fs.readFileSync(localPathOf(e.path)); } catch { continue; } // only files that exist here are updated
    if (gitBlobSha(local) !== e.sha) changed.push({ rel: e.path, sha: e.sha });
  }
  return changed;
}
let dashCache = null;
async function dashboardState(force) {
  if (!INSTALLED_EARLY()) return null;
  if (!force && dashCache && Date.now() - dashCache.at < (dashCache.error ? 60000 : 300000)) return dashCache.value;
  let value = null, error = false;
  try { value = { files: (await dashboardDiff()).length, auto: true, since: (() => { try { return fs.statSync(path.join(HERE, 'server.mjs')).mtime.toISOString(); } catch { return ''; } })() }; } catch (e) { value = { error: e.message, auto: true }; error = true; }
  dashCache = { at: Date.now(), value, error };
  return value;
}
let dashUpdating = false;
async function updateDashboard() {
  if (!INSTALLED_EARLY()) throw new Error('Ky dashboard nuk është i instaluar (po punon nga folderi i zhvillimit): përditësohet vetëm ai i instaluar.');
  if (dashUpdating) throw new Error('Përditësimi po vazhdon, prit pak.');
  dashUpdating = true;
  try {
    const changed = await dashboardDiff();
    if (!changed.length) { dashCache = null; return { ok: true, files: 0 }; }
    const files = [];
    for (const c of changed) {
      const blob = await ghJson(`https://api.github.com/repos/${DASH_REPO}/git/blobs/${c.sha}`);
      const buf = Buffer.from(blob.content || '', 'base64');
      if (gitBlobSha(buf) !== c.sha) throw new Error('Skedari ' + c.rel + ' nuk u shkarkua i plotë.');
      files.push({ rel: c.rel, buf });
    }
    files.sort((a, b) => (a.rel === 'server.mjs') - (b.rel === 'server.mjs'));
    const server = files.find((f) => f.rel === 'server.mjs');
    if (server) {
      const probe = path.join(HERE, 'server.check.mjs');
      fs.writeFileSync(probe, server.buf);
      try { await run(process.execPath, ['--check', probe]); } catch (e) { throw new Error('Kodi i ri i dashboard-it nuk është i vlefshëm, nuk u ndryshua asgjë: ' + e.message); } finally { fs.rmSync(probe, { force: true }); }
    }
    const prev = path.join(HERE, '.previous');
    fs.rmSync(prev, { recursive: true, force: true });
    for (const f of files) {
      const full = localPathOf(f.rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (fs.existsSync(full)) { const keep = path.join(prev, f.rel); fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.copyFileSync(full, keep); }
    }
    if (server) fs.writeFileSync(path.join(HERE, '.updating'), String(Date.now())); // read by the restart: starts the guard
    for (const f of files) fs.writeFileSync(localPathOf(f.rel), f.buf);
    dashCache = null;
    return { ok: true, files: files.length };
  } finally { dashUpdating = false; }
}
// After a self-update the old process starts this guard before it ends: if the new dashboard does not answer within 25 s, the old files are
// put back and started again (a new version that parses but breaks at start must never leave the PC without a dashboard).
const GUARD = `
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const dir = process.argv[1];
const flag = path.join(dir, '.updating');
setTimeout(() => {
  let url = '';
  try { url = fs.readFileSync(path.join(dir, '..', 'dashboard-url.txt'), 'utf8').trim(); } catch { url = ''; }
  const restore = () => {
    const prev = path.join(dir, '.previous');
    const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = path.join(rel, e.name); if (e.isDirectory()) walk(path.join(d, e.name), r); else fs.copyFileSync(path.join(d, e.name), r.startsWith('root' + path.sep) ? path.join(dir, '..', r.slice(5)) : path.join(dir, r)); } };
    try { walk(prev, ''); } catch {}
    try { fs.rmSync(flag, { force: true }); } catch {}
    try { cp.spawn(process.execPath, [path.join(dir, 'server.mjs')], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch {}
  };
  if (!url) { try { fs.rmSync(flag, { force: true }); } catch {} return; }
  http.get(url, (r) => { r.resume(); try { fs.rmSync(flag, { force: true }); } catch {} }).on('error', restore).setTimeout(5000, function () { this.destroy(); });
}, 25000);
`;
function startGuard() {
  try { if (fs.existsSync(path.join(HERE, '.updating'))) spawn(process.execPath, ['-e', GUARD, HERE], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* no guard */ }
}
// Automatic: first check 2 minutes after the start, then every 10 minutes.
async function autoUpdateDashboard() {
  try { const s = await dashboardState(true); if (s && s.files > 0) await updateDashboard(); } catch { /* next round */ }
}
function INSTALLED_EARLY() { return fs.existsSync(path.join(path.dirname(HERE), 'current.txt')); }
if (INSTALLED_EARLY()) { setTimeout(autoUpdateDashboard, 120000).unref(); setInterval(autoUpdateDashboard, 600000).unref(); }

function access_domain_or_local(access, inst) { return access.domain || inst.url || access.local; }

function uninstallerOf(inst) {
  return ['Uninstall.bat', 'uninstall.bat'].map((f) => path.join(inst.root, f)).find((f) => fs.existsSync(f)) || null;
}

// GitHub is asked at most every 5 minutes (every minute after an error): the page refreshes every 30 s, which would go over the 60 requests an hour of an unauthenticated client.
const latestCache = new Map();
async function latestCached(inst) {
  const c = latestCache.get(inst.id);
  if (c && Date.now() - c.at < (c.value && c.value.error ? 60000 : 300000)) return c.value;
  const value = await latest(inst).catch((e) => ({ error: e.message }));
  latestCache.set(inst.id, { at: Date.now(), value });
  return value;
}

function updateKind(i, l) {
  if (i && !i.error && l && !l.error) {
    if (cmp(l.version, i.version) > 0) return 'version';
    // Same number (1.0.0 is re-released while it is stabilised): the build marker tells. An installation without a marker (installed by hand)
    // cannot tell, so it is offered the update once; the updater writes the marker.
    if (cmp(l.version, i.version) === 0 && l.build && (!i.build || l.build !== i.build)) return 'build';
  }
  return null;
}

// ONE automatic night job (owner, 2026-10-22: a backup at 02:00 and an update at 03:00 would save the database twice). Once a day, at the chosen hour
// (default 02:00): when GitHub has a newer version or build of the program and "updateToo" is on, the update runs, and since the updater always begins
// with a database backup, that is the day's backup (nothing is saved twice); otherwise the dashboard makes the backup itself. Only the newest `keep`
// automatic backups are kept; manual ones and the updater's are never deleted by this rule. The result of the last run is shown in Veprime.
function autoBackupOf(inst) {
  const s = readSettings(inst);
  return { on: s.autoBackup !== false, hour: Number.isInteger(s.autoBackupHour) ? s.autoBackupHour : 2, keep: Number.isInteger(s.autoBackupKeep) ? s.autoBackupKeep : 14, updateToo: s.autoUpdate !== false, last: s.autoBackupLast || null };
}
function setAutoBackup(inst, on, hour, keep, updateToo) {
  const cur = readSettings(inst);
  cur.autoBackup = Boolean(on);
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) cur.autoBackupHour = hour;
  if (Number.isInteger(keep) && keep >= 1 && keep <= 365) cur.autoBackupKeep = keep;
  if (updateToo !== undefined) cur.autoUpdate = Boolean(updateToo);
  try { fs.writeFileSync(settingsFile(inst), JSON.stringify(cur, null, 2)); } catch { /* read-only folder */ }
  return autoBackupOf(inst);
}
function saveAutoResult(inst, record, result, name) {
  const cur = readSettings(inst); cur.autoBackupLast = { ...record, result, name };
  try { fs.writeFileSync(settingsFile(inst), JSON.stringify(cur, null, 2)); } catch { /* read-only folder */ }
}
function rememberAndPrune(inst, names, keep) {
  const mine = readSettings(inst); mine.autoBackupFiles = [...new Set([...(mine.autoBackupFiles || []), ...names])].slice(-400);
  try { fs.writeFileSync(settingsFile(inst), JSON.stringify(mine, null, 2)); } catch { /* read-only folder */ }
  const madeHere = new Set(mine.autoBackupFiles);
  for (const old of listBackups(inst).filter((x) => madeHere.has(x.name)).slice(keep)) { try { fs.unlinkSync(path.join(backupDir(inst), old.name)); } catch { /* in use */ } }
}
async function autoBackupTick() {
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  for (const inst of instances()) {
    if (!inst.root || !inst.data) continue;
    const auto = autoBackupOf(inst);
    // two independent switches (backup, update of the program), one shared hour: either, both or none
    if ((!auto.on && !auto.updateToo) || now.getHours() !== auto.hour || (auto.last && auto.last.date === today)) continue;
    const running = jobs.get(inst.id);
    if (running && running.state === 'running') continue;
    const record = { date: today, at: new Date().toISOString() };
    const kind = auto.updateToo ? updateKindPinned(inst, installed(inst), await latestCached(inst).catch(() => null)) : null;
    if (kind) {
      // the update makes the backup (its first step): one backup, then the new version
      saveAutoResult(inst, record, 'update_started');
      try {
        const job = runUpdate(inst);
        job.lines.push('Perditesim automatik (nata): backup i databazes (nje here), pastaj versioni i ri.');
        const started = job.started;
        const done = setInterval(() => {
          if (job.state === 'running') return;
          clearInterval(done);
          saveAutoResult(inst, record, job.state === 'ok' ? 'update_ok' : 'update_error');
          try { rememberAndPrune(inst, listBackups(inst).filter((x) => Date.parse(x.time) >= started - 2000).map((x) => x.name), auto.keep); } catch { /* next time */ }
        }, 5000);
      } catch { saveAutoResult(inst, record, 'skipped: një veprim tjetër po ekzekutohej'); }
      continue;
    }
    if (!auto.on) { saveAutoResult(inst, record, 'nothing'); continue; } // backup is off and there is no update
    saveAutoResult(inst, record, 'started');
    try {
      const made = await backup(inst);
      saveAutoResult(inst, record, 'ok', made.name);
      rememberAndPrune(inst, [made.name], auto.keep);
    } catch (e) { saveAutoResult(inst, record, 'error: ' + String(e.message).slice(0, 120)); }
  }
}
setInterval(() => { autoBackupTick().catch(() => {}); }, 60000).unref();

// ======================= Professional extras (owner, 2026-10-22) =======================
// History of actions, notifications to the phone, an off-PC copy of every backup, backup check, disk space, resources, optional password, diagnostics.
const settingsWrite = (inst, cur) => { try { fs.writeFileSync(settingsFile(inst), JSON.stringify(cur, null, 2)); } catch { /* read-only folder */ } };

// ---- history (the last 200 actions, kept in dashboard-settings.json)
function addHistory(inst, entry) {
  const cur = readSettings(inst), h = Array.isArray(cur.history) ? cur.history : [];
  h.push({ at: Date.now(), ...entry });
  cur.history = h.slice(-200);
  settingsWrite(inst, cur);
}
function jobDone(inst, job) {
  const last = job.lines[job.lines.length - 1] || '';
  const ok = job.state === 'ok';
  addHistory(inst, { title: job.title, ok, detail: last.slice(0, 160) });
  if (!ok) notify(inst, 'Veprimi dështoi', job.title + (last ? ': ' + last.slice(0, 140) : ''));
  else if (job.title === 'Perditesim' || job.title === 'Rikthim i versionit') notify(inst, job.title === 'Perditesim' ? 'Përditësimi u krye' : 'Rikthimi i versionit u krye', (inst.name || '') + ' · versioni ' + ((installed(inst) || {}).name || '?'));
}

// ---- notifications: ntfy.sh (a topic name the owner subscribes to in the free ntfy phone app) or any webhook URL; opt-in, off until set
function notifyOf(inst) { const n = readSettings(inst).notify || {}; return { on: !!n.on, target: String(n.target || '') }; }
async function sendNotify(target, title, message) {
  if (!target) throw new Error('Mungon adresa e njoftimit.');
  const isUrl = /^https?:\/\//i.test(target);
  const r = await fetch(isUrl ? target : 'https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isUrl ? { title, message, text: title + ': ' + message } : { topic: target, title, message, priority: 4 }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Shërbimi i njoftimit u përgjigj ' + r.status + '.');
}
function notify(inst, title, message) {
  const n = notifyOf(inst);
  if (!n.on || !n.target) return;
  sendNotify(n.target, title, message).catch(() => { /* a failed notification never breaks anything */ });
}
function setNotify(inst, on, target) {
  const cur = readSettings(inst);
  const t = target === undefined ? String((cur.notify || {}).target || '') : String(target).trim();
  if (t && !/^[A-Za-z0-9_-]{3,64}$/.test(t) && !/^https?:\/\/\S+$/i.test(t)) throw new Error('Adresa: një emër teme (shkronja, shifra, - _ ; min. 3) ose një URL https.');
  cur.notify = { on: !!on && !!t, target: t };
  settingsWrite(inst, cur);
  return notifyOf(inst);
}
// Watcher: the app is down for 2 minutes -> a message; it is back -> a message. Not while an update / rollback runs. Low disk: once a day.
const watch = new Map();
async function watchTick() {
  for (const inst of instances()) {
    if (!inst.root || !inst.local) continue;
    const w = watch.get(inst.id) || { down: 0, told: false };
    watch.set(inst.id, w);
    const job = jobs.get(inst.id);
    let ok = false;
    try { ok = (await fetch(inst.local + '/api/health', { signal: AbortSignal.timeout(5000) })).ok; } catch { ok = false; }
    if (ok || (job && job.state === 'running')) {
      if (ok && w.told) { notify(inst, 'Aplikacioni u kthye', (inst.name || '') + ' punon përsëri.'); addHistory(inst, { title: 'Aplikacioni u kthye online', ok: true, detail: '' }); }
      w.down = 0; w.told = false;
    } else {
      if (!w.down) w.down = Date.now();
      if (!w.told && Date.now() - w.down >= 120000) { w.told = true; notify(inst, 'Aplikacioni ka rënë', (inst.name || '') + ' nuk përgjigjet prej 2 minutash.'); addHistory(inst, { title: 'Aplikacioni nuk përgjigjet', ok: false, detail: 'prej ' + new Date(w.down).toLocaleTimeString('sq-AL', { hour12: false }) }); }
    }
    const d = diskOf(inst.data || inst.root);
    if (d && d.total && d.free / d.total < 0.1) {
      const cur = readSettings(inst), day = new Date().toISOString().slice(0, 10);
      if (cur.lastDiskAlert !== day) { cur.lastDiskAlert = day; settingsWrite(inst, cur); notify(inst, 'Pak hapësirë në disk', 'Mbeten ' + (d.free / 1073741824).toFixed(1) + ' GB (' + Math.round((100 * d.free) / d.total) + '%).'); addHistory(inst, { title: 'Pak hapësirë në disk', ok: false, detail: (d.free / 1073741824).toFixed(1) + ' GB të lira' }); }
    }
  }
}
setInterval(() => { watchTick().catch(() => {}); }, 30000).unref();

// ---- off-PC copy: every .sql of the backup folder is copied to a folder the owner chooses (external disk, network share, a cloud-synced folder)
function offsiteOf(inst) { const o = readSettings(inst).offsite || {}; return { on: !!o.on, path: String(o.path || ''), last: readSettings(inst).offsiteLast || null }; }
function checkOffsitePath(p) {
  if (!/^[A-Za-z]:[\\/]/.test(p) && !/^\\\\[^\\]+\\[^\\]+/.test(p)) throw new Error('Shkruaj një rrugë të plotë, p.sh. E:\\HRBackup ose \\\\server\\share.');
  fs.mkdirSync(p, { recursive: true });
  const t = path.join(p, '.hrsystem-write-test');
  fs.writeFileSync(t, 'ok'); fs.rmSync(t, { force: true });
}
function setOffsite(inst, on, p) {
  const cur = readSettings(inst);
  const target = p === undefined ? String((cur.offsite || {}).path || '') : String(p).trim();
  if (target) checkOffsitePath(target);
  cur.offsite = { on: !!on && !!target, path: target };
  settingsWrite(inst, cur);
  return offsiteOf(inst);
}
let offsiteBusy = false;
async function syncOffsite(inst, force) {
  const o = offsiteOf(inst);
  if ((!o.on && !force) || !o.path || offsiteBusy) return o.last;
  offsiteBusy = true;
  const record = { at: new Date().toISOString(), ok: true, copied: 0, error: '' };
  try {
    checkOffsitePath(o.path);
    for (const b of listBackups(inst)) {
      if (/\.tmp\.sql$/i.test(b.name)) continue;
      const to = path.join(o.path, b.name);
      let same = false; try { same = fs.statSync(to).size === b.size; } catch { /* not there */ }
      if (same) continue;
      fs.copyFileSync(path.join(backupDir(inst), b.name), to + '.part');
      fs.renameSync(to + '.part', to);
      record.copied++;
    }
  } catch (e) { record.ok = false; record.error = String(e.message).slice(0, 160); }
  finally { offsiteBusy = false; }
  const cur = readSettings(inst), before = cur.offsiteLast;
  cur.offsiteLast = record; settingsWrite(inst, cur);
  if (!record.ok && (!before || before.ok)) { notify(inst, 'Kopja jashtë PC-së dështoi', record.error); addHistory(inst, { title: 'Kopja jashtë PC-së', ok: false, detail: record.error }); }
  if (record.ok && record.copied) addHistory(inst, { title: 'Kopja jashtë PC-së', ok: true, detail: record.copied + ' backup u kopjuan te ' + o.path });
  return record;
}
setInterval(() => { for (const inst of instances()) if (inst.root && inst.data) syncOffsite(inst).catch(() => {}); }, 300000).unref();

// ---- backup check: a dump that ends with mysqldump's closing line is complete
const checkSeen = new Map();
function checkBackup(inst, b) {
  const k = b.name + '|' + b.size + '|' + b.time;
  if (checkSeen.has(k)) return checkSeen.get(k);
  let ok = false;
  try {
    const fd = fs.openSync(path.join(backupDir(inst), b.name), 'r');
    try { const n = Math.min(400, b.size), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, b.size - n); ok = b.size > 1024 && buf.toString('utf8').includes('Dump completed'); } finally { fs.closeSync(fd); }
  } catch { ok = false; }
  if (checkSeen.size > 500) checkSeen.clear();
  checkSeen.set(k, ok);
  return ok;
}

// ---- disk and resources
function diskOf(p) {
  try { const s = fs.statfsSync(p); return { path: p, free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }; } catch { return null; }
}
// How much disk the HR system uses (its program folder, its database files and its backups), not the whole disk. Counted in the background every 10 minutes.
const usageSeen = new Map();
async function refreshUsage(inst) {
  const prev = usageSeen.get(inst.id) || { at: 0, value: null };
  usageSeen.set(inst.id, { ...prev, busy: true });
  let value = prev.value;
  try {
    const q2 = (t) => String(t).replace(/'/g, "''");
    const data = inst.data || '';
    const out = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `$ErrorActionPreference='SilentlyContinue'; function Sz($p) { if ($p -and (Test-Path -LiteralPath $p)) { [int64](Get-ChildItem -LiteralPath $p -Recurse -File -Force | Measure-Object Length -Sum).Sum } else { 0 } }; ` +
      `'root|' + (Sz '${q2(inst.root)}'); 'data|' + (Sz '${q2(data)}'); 'db|' + (Sz '${q2(path.join(data, 'MySQLData'))}'); 'bk|' + (Sz '${q2(path.join(data, 'Backups'))}')`]);
    const m = Object.fromEntries(out.split(/\r?\n/).map((l) => l.trim().split('|')).filter((p) => p.length === 2).map((p) => [p[0], Number(p[1]) || 0]));
    const inside = data && data.toLowerCase().startsWith(inst.root.toLowerCase().replace(/[\\/]+$/, '') + '\\');
    const program = Math.max(0, (m.root || 0) - (inside ? m.data || 0 : 0));
    value = { program, db: m.db || 0, backups: m.bk || 0, total: program + (m.data || 0) };
  } catch { /* keep the last value */ }
  usageSeen.set(inst.id, { at: Date.now(), value, busy: false });
}
function usageOf(inst) {
  if (!inst.root) return null;
  const c = usageSeen.get(inst.id);
  if (!c || (!c.busy && Date.now() - c.at > 600000)) refreshUsage(inst).catch(() => {});
  return (c && c.value) || null;
}
// CPU and RAM of the HR system ONLY (the application's node process and its MySQL), not of the whole computer. One PowerShell look every 15 s per installation.
const procSeen = new Map();
async function procStats(inst) {
  const c = procSeen.get(inst.id);
  if (c && Date.now() - c.at < 15000) return c.value;
  let value = { appSince: null, cpu: 0, ram: 0, appRam: 0, dbRam: 0 };
  try {
    let env = {}; try { env = readEnv(path.join(inst.root, '.env')); } catch { /* none */ }
    const appPort = Number(env.PORT) || 3000, dbPort = Number(env.DB_PORT) || 3306;
    // The processes are found by the port they listen on (the application's PORT and the database's DB_PORT): exactly this installation's, whatever the command line.
    const net = await run('netstat', ['-ano']);
    const pidOn = (port) => { for (const l of net.split(/\r?\n/)) { const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(l); if (m && Number(m[1]) === port) return Number(m[2]); } return 0; };
    const appPid = pidOn(appPort), dbPid = pidOn(dbPort);
    const out = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `$ErrorActionPreference='SilentlyContinue'; $cores=[Environment]::ProcessorCount; $appPid=${appPid}; $dbPid=${dbPid}; ` +
      `if ($appPid) { 'since|' + (Get-Process -Id $appPid).StartTime.ToUniversalTime().ToString('o') }; ` +
      `foreach ($pp in (Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -gt 0 -and $_.IDProcess -in @($appPid, $dbPid) })) { ($(if ($pp.IDProcess -eq $appPid) { 'app' } else { 'db' })) + '|' + $pp.PercentProcessorTime + '|' + $pp.WorkingSetPrivate }; "cores|$cores"`]);
    let cores = 1, cpu = 0;
    for (const l of out.split(/\r?\n/)) {
      const p = l.trim().split('|');
      if (p[0] === 'since') value.appSince = p[1];
      else if (p[0] === 'cores') cores = Number(p[1]) || 1;
      else if (p[0] === 'app') { cpu += Number(p[1]) || 0; value.appRam = Number(p[2]) || 0; }
      else if (p[0] === 'db') { cpu += Number(p[1]) || 0; value.dbRam = Number(p[2]) || 0; }
    }
    value.cpu = Math.min(100, Math.round((cpu / cores) * 10) / 10); value.ram = value.appRam + value.dbRam;
  } catch { /* leave zeros */ }
  procSeen.set(inst.id, { at: Date.now(), value });
  return value;
}
async function systemOf(inst) {
  const hr = inst.root ? await procStats(inst) : { appSince: null, cpu: 0, ram: 0, appRam: 0, dbRam: 0 };
  return { cpu: hr.cpu, ram: hr.ram, appRam: hr.appRam, dbRam: hr.dbRam, memTotal: os.totalmem(), up: os.uptime(), appSince: hr.appSince, disk: { data: diskOf(inst.data || inst.root || '.'), root: inst.root ? diskOf(inst.root) : null } };
}

// ---- the sign-in password: optional, set from the settings (manager/dashboard.key; DASHBOARD_KEY in the environment cannot be changed here)
function setDashboardPassword(pw) {
  if (process.env.DASHBOARD_KEY) throw new Error('Fjalëkalimi vjen nga variabla DASHBOARD_KEY: ndryshoje atje.');
  const p = String(pw || '');
  if (!p) { try { fs.rmSync(KEY_FILE, { force: true }); } catch { /* none */ } }
  else {
    if (p.length < 6 || p.length > 100) throw new Error('Fjalëkalimi: 6 deri në 100 shkronja.');
    fs.writeFileSync(KEY_FILE, p);
  }
  LOGIN_KEY = dashboardKey();
  COOKIE = crypto.createHash('sha256').update('dashboard:' + LOGIN_KEY).digest('hex');
  SIGN_IN = LOGIN_KEY.length > 0;
}

// ---- diagnostics: one text file with the state and the log tails (secrets masked), for when a problem has to be sent to someone
const mask = (t) => String(t).replace(/((?:pass(?:word)?|secret|token|key|authorization)[A-Za-z_]*\s*[=:]\s*)\S+/gi, '$1***');
function tailOf(file, n) { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-n).join('\n'); } catch { return '(nuk ekziston)'; } }
async function diagnostics(inst) {
  const s = await status(inst);
  const sys = await systemOf(inst);
  let env = {}; try { env = readEnv(path.join(inst.root, '.env')); } catch { /* none */ }
  const safeEnv = Object.entries(env).map(([k, v]) => k + '=' + (/^(PORT|DB_HOST|DB_PORT|DB_NAME|APP_ORIGIN|NODE_ENV)$/.test(k) ? v : '***')).join('\n');
  const gb = (n) => (n / 1073741824).toFixed(1) + ' GB';
  const lines = [
    'HRSystem Dashboard · diagnostikë', 'Krijuar: ' + new Date().toISOString(), 'Instalimi: ' + inst.name, '',
    '== Sistemi ==', 'Windows ' + os.release() + ' · Node ' + process.version + ' · kompjuteri ' + os.hostname(), 'Sistemi HR: CPU ' + sys.cpu + '% të kompjuterit · RAM ' + Math.round(sys.ram / 1048576) + ' MB (aplikacioni ' + Math.round(sys.appRam / 1048576) + ', databaza ' + Math.round(sys.dbRam / 1048576) + ') · kompjuteri ndezur ' + Math.round(sys.up / 3600) + ' orë',
    'Disku i të dhënave: ' + (sys.disk.data ? gb(sys.disk.data.free) + ' të lira nga ' + gb(sys.disk.data.total) + ' (' + sys.disk.data.path + ')' : '?'), '',
    '== Aplikacioni ==', 'Instaluar: ' + JSON.stringify(s.installed), 'Më i ri në repo: ' + JSON.stringify(s.latest), 'Version i ngjitur: ' + JSON.stringify(s.pinned), 'Shëndeti: ' + JSON.stringify(s.health && { ok: s.health.ok, ms: s.health.ms, database: s.health.database }), 'Aplikacioni ndezur prej: ' + (sys.appSince || '?'), '',
    '== Cilësimet (.env, sekretet të fshehura) ==', safeEnv, '',
    '== Backup-et ==', ...s.backups.map((b) => b.name + ' · ' + Math.round(b.size / 1024) + ' KB · ' + b.time + ' · versioni ' + (b.version || '?') + ' · ' + (b.check ? 'OK' : 'DËMTUAR')),
    'Kopja jashtë PC-së: ' + JSON.stringify(offsiteOf(inst)), 'Automatik: ' + JSON.stringify(autoBackupOf(inst)), '',
    '== Historiku (të fundit) ==', ...(readSettings(inst).history || []).slice(-30).map((h) => new Date(h.at).toISOString() + ' · ' + h.title + ' · ' + (h.ok ? 'OK' : 'GABIM') + ' · ' + (h.detail || '')), '',
    '== Veprimi i fundit ==', ...((jobs.get(inst.id) || { lines: ['-'] }).lines), '',
    '== Updater.log (fundi) ==', tailOf(path.join(inst.root, 'Updater.log'), 60), '',
    '== HRSystem-Server.log (fundi) ==', tailOf(path.join(inst.root, 'HRSystem-Server.log'), 60), '',
    '== Dashboard.log (fundi) ==', tailOf(path.join(inst.root, 'Dashboard.log'), 40),
  ];
  return mask(lines.join('\n'));
}

async function status(inst) {
  const [h, l] = await Promise.all([health(inst), latestCached(inst)]);
  const i = installed(inst);
  recordVersion(inst);
  const sys = await systemOf(inst);
  const update = updateKindPinned(inst, i, l);
  let env = {};
  try { env = readEnv(path.join(inst.root, '.env')); } catch { /* none */ }
  const tokenSet = !!(await token(inst).catch(() => ''));
  const [access, setupState] = await Promise.all([
    accessOf(inst, env),
    fetch(inst.local + '/api/setup', { signal: AbortSignal.timeout(5000), cache: 'no-store' }).then((r) => r.json()).catch(() => null),
  ]);
  return { id: inst.id, name: inst.name, url: access_domain_or_local(access, inst), autoBackup: autoBackupOf(inst), autostart: inst.root ? await autostartState(inst).catch(() => []) : [], tokenSet, paths: pathsOf(inst, env), access, ownerMissing: !!(setupState && setupState.ready === true), canUninstall: !!uninstallerOf(inst), pinned: pinOf(inst), database: { name: env.DB_NAME || '', host: env.DB_HOST || '', port: env.DB_PORT || '' }, repo: inst.repo || null, channel: inst.channel || null, local: !!inst.root, note: inst.note || '', health: h, installed: i, latest: l, update, backups: withVersions(inst, listBackups(inst).slice(0, 8)).map((b) => ({ ...b, check: checkBackup(inst, b) })), system: sys, usage: usageOf(inst), history: (readSettings(inst).history || []).slice(-100).reverse(), notify: notifyOf(inst), offsite: offsiteOf(inst), job: jobs.get(inst.id) || null };
}

// ---- Start with Windows (owner, 2026-10-22): the owner can stop or enable the automatic start of each part, or all at once ----
// The application and the dashboard start from Task Scheduler tasks (at logon), MySQL and the Cloudflare tunnel are Windows services. Stopping the
// automatic start does not stop what is running now; it only decides what starts after the next logon / restart of the computer.
const autostartItems = (inst) => [
  { key: 'app', label: 'Aplikacioni', kind: 'task', name: inst.task || 'HRSystem' },
  { key: 'dashboard', label: 'Dashboard-i', kind: 'task', name: 'HRSystem-Dashboard' },
  { key: 'mysql', label: 'Databaza (MySQL)', kind: 'service', name: 'HRSystemMySQL' },
  { key: 'tunnel', label: 'Tuneli Cloudflare', kind: 'service', name: 'cloudflared' },
];
const autostartSeen = new Map(); // inst.id -> { at, list }
async function autostartState(inst, force) {
  const c = autostartSeen.get(inst.id);
  if (!force && c && Date.now() - c.at < 15000) return c.list;
  const items = autostartItems(inst);
  const script = items.map((i) => i.kind === 'task'
    ? `$t = Get-ScheduledTask -TaskName ${q(i.name)} -ErrorAction SilentlyContinue; if ($t) { '${i.key}|1|' + [int](@($t | Where-Object { $_.Settings.Enabled }).Count -gt 0) + '|' + (@($t | ForEach-Object { $_.TaskPath + $_.TaskName + '=' + $_.State + '/' + $_.Settings.Enabled }) -join ',') } else { '${i.key}|0|0|' }`
    : `$s = Get-CimInstance Win32_Service -Filter "Name='${i.name}'" -ErrorAction SilentlyContinue; if ($s) { '${i.key}|1|' + [int]($s.StartMode -ne 'Disabled' -and $s.StartMode -ne 'Manual') } else { '${i.key}|0|0' }`).join('; ');
  let out = '';
  try { out = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]); } catch { out = ''; }
  const seen = Object.fromEntries(out.split(/\r?\n/).map((l) => l.trim().split('|')).filter((p) => p.length >= 3).map((p) => [p[0], { exists: p[1] === '1', on: p[2] === '1', detail: p[3] || '' }]));
  const list = items.map((i) => ({ key: i.key, label: i.label, exists: !!(seen[i.key] && seen[i.key].exists), on: !!(seen[i.key] && seen[i.key].on), detail: (seen[i.key] && seen[i.key].detail) || '' }));
  // The application and its database start together (one switch): they are shown as one item; the dashboard and the tunnel are separate.
  const app = list.find((x) => x.key === 'app'), db = list.find((x) => x.key === 'mysql');
  const parts = [app, db].filter((x) => x && x.exists);
  const grouped = [
    { key: 'app', label: 'Aplikacioni + databaza', exists: parts.length > 0, on: parts.length > 0 && parts.every((x) => x.on), detail: parts.map((x) => x.label + (x.on ? ': po' : ': jo')).join(', ') },
    ...list.filter((x) => x.key === 'dashboard' || x.key === 'tunnel'),
  ];
  autostartSeen.set(inst.id, { at: Date.now(), list: grouped });
  return grouped;
}
async function setAutostart(inst, which, on) {
  needLocal(inst);
  const keys = which === 'all' ? ['app', 'mysql', 'dashboard', 'tunnel'] : which === 'app' ? ['app', 'mysql'] : [which];
  const items = autostartItems(inst).filter((i) => keys.includes(i.key));
  if (!items.length) throw new Error('Pjesë e panjohur.');
  const script = items.map((i) => i.kind === 'task'
    ? `if (Get-ScheduledTask -TaskName ${q(i.name)} -ErrorAction SilentlyContinue) { ${on ? 'Enable' : 'Disable'}-ScheduledTask -TaskName ${q(i.name)} | Out-Null }`
    : `if (Get-Service -Name ${q(i.name)} -ErrorAction SilentlyContinue) { Set-Service -Name ${q(i.name)} -StartupType ${on ? 'Automatic' : 'Manual'} }`).join('; ');
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', "$ErrorActionPreference = 'Stop'; " + script]);
  autostartSeen.delete(inst.id);
  return autostartState(inst, true);
}

// ---- Live (owner, 2026-10-22: "100% live") ----
// The page keeps one Server-Sent Events connection (/api/live). While at least one page is open the dashboard takes ONE light pulse every 3 s: a single
// /api/health request to the application per installation (not the 3 samples of the full status), the job (progress and log) and a signature of
// what changes (job, backups, installed version). The pulse goes to every open page; when the signature changes a "changed" event makes the page
// reload the full status at once. With no page open nothing runs, so the application feels no difference.
// The id of what the page is made of (the two files' times): the pulse carries it, and a page that was loaded with another id reloads itself once.
function pageVersion() {
  try { return Math.round(fs.statSync(path.join(HERE, 'server.mjs')).mtimeMs) + '-' + Math.round(fs.statSync(path.join(HERE, 'public', 'index.html')).mtimeMs); } catch { return '0'; }
}
const liveClients = new Set();
const liveLast = new Map(); // inst.id -> signature
let liveTimer = null;
const downSeen = new Map(); // inst.id -> when the application was last found off (an off application is checked every 15 s, not every 3 s)
async function pulseOnce() {
  return Promise.all(instances().map(async (inst) => {
    const t0 = performance.now();
    let ok = false, ms = 0, database = null;
    const was = downSeen.get(inst.id);
    if (was && Date.now() - was < 15000) { /* off: not asked again for 15 s */ }
    else {
      try {
        const r = await fetch(inst.local + '/api/health', { signal: AbortSignal.timeout(2500), cache: 'no-store' });
        const j = await r.json().catch(() => null);
        ok = r.status === 200 && !!j && j.ok === true; ms = Math.max(1, Math.round(performance.now() - t0)); database = (j && j.database) || null;
      } catch { ok = false; }
      if (ok) downSeen.delete(inst.id); else downSeen.set(inst.id, Date.now());
    }
    const job = jobs.get(inst.id) || null;
    let backups = [];
    try { backups = inst.data ? listBackups(inst) : []; } catch { backups = []; }
    const inst2 = inst.root ? installed(inst) : null;
    const sig = [job && job.state, job && job.ended, backups.length, backups[0] && backups[0].name, inst2 && inst2.name, quickUrlOf(inst)].join('|');
    return { id: inst.id, ok, ms: ok ? ms : 0, database, sig, job: job ? { title: job.title, state: job.state, started: job.started, ended: job.ended || null, lines: job.lines.slice(-80) } : null };
  }));
}
function liveStart() {
  if (liveTimer) return;
  const tick = async () => {
    if (!liveClients.size) { liveTimer = null; return; }
    try {
      const list = await pulseOnce();
      let changed = false;
      for (const p of list) { if (liveLast.has(p.id) && liveLast.get(p.id) !== p.sig) changed = true; liveLast.set(p.id, p.sig); }
      const body = JSON.stringify({ at: new Date().toISOString(), v: pageVersion(), k: BOOT_ID, instances: list.map(({ sig, ...rest }) => rest) });
      for (const res of liveClients) {
        try { res.write('event: pulse\ndata: ' + body + '\n\n'); if (changed) res.write('event: changed\ndata: {}\n\n'); } catch { liveClients.delete(res); }
      }
    } catch { /* next pulse */ }
    liveTimer = setTimeout(tick, 3000);
  };
  liveTimer = setTimeout(tick, 0);
}
setInterval(() => { for (const res of liveClients) { try { res.write(': keep-alive\n\n'); } catch { liveClients.delete(res); } } }, 20000).unref();

const statusShared = { at: 0, promise: null };
const send = (res, code, data, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
};

const server = http.createServer(async (req, res) => {
  // Only this machine, only its own page: blocks DNS-rebinding and other sites calling the API.
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return send(res, 403, { error: 'forbidden' });
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/login') {
      const now = Date.now();
      failures = failures.filter((t) => now - t < 60000);
      if (failures.length >= 5) return send(res, 429, { error: 'too_many' });
      let body = '';
      for await (const c of req) { body += c; if (body.length > 1000) break; }
      let given = '';
      try { given = JSON.parse(body).key; } catch { /* wrong */ }
      if (!sameText(given, LOGIN_KEY)) { failures.push(now); return send(res, 403, { error: 'wrong_key' }); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `mgr=${COOKIE}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`, 'Cache-Control': 'no-store' });
      return res.end('{"ok":true}');
    }
    if (!authed(req)) {
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, LOGIN_HTML, 'text/html');
      return send(res, 401, { error: 'sign_in_required' });
    }
    if (req.method === 'GET' && url.pathname === '/') {
      let page;
      try { page = fs.readFileSync(path.join(HERE, 'public', 'index.html'), 'utf8'); }
      catch (e) {
        // Usually a process without administrator rights in a folder closed to ordinary users: say what to do instead of a raw error.
        return send(res, 500, '<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:24px"><h2>Dashboard-i nuk lexon skedaret e veta</h2><p>' + String(e.code || e.message).replace(/[<>&]/g, '') + '</p><p>Mbylle dhe hape perseri me <b>Dashboard.bat</b> (kerkon Administrator), ose ekzekuto ne PowerShell Administrator:<br><code>icacls C:\\HRSystem\\manager /grant "*S-1-5-32-545:(OI)(CI)RX" /T</code></p></body>', 'text/html');
      }
      return send(res, 200, page.replace('__KEY__', SESSION_KEY).replace('__VER__', pageVersion()).replace('__BOOT__', BOOT_ID), 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/api/live') {
      if (liveClients.size >= 8) return send(res, 429, { error: 'too_many_pages' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write('retry: 3000\n\n');
      liveClients.add(res);
      req.on('close', () => liveClients.delete(res));
      liveStart();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      if (!statusShared.promise || Date.now() - statusShared.at > 3000) {
        statusShared.at = Date.now();
        statusShared.promise = (async () => ({ instances: await Promise.all(instances().map(status)), dashboard: await dashboardState().catch(() => null), dashboardRepo: DASH_REPO, security: { password: SIGN_IN, env: !!process.env.DASHBOARD_KEY }, at: new Date().toISOString() }))();
        statusShared.promise.catch(() => { statusShared.promise = null; });
      }
      return send(res, 200, await statusShared.promise);
    }
    if (req.method === 'POST' && url.pathname === '/api/backup') {
      if (req.headers['x-manager-key'] !== SESSION_KEY) return send(res, 403, { error: 'forbidden' });
      const inst = find(url.searchParams.get('id'));
      if (!inst) return send(res, 404, { error: 'Instalimi nuk u gjet.' });
      return send(res, 200, await backup(inst));
    }
    if (req.method === 'GET' && url.pathname === '/api/job') {
      return send(res, 200, jobs.get(url.searchParams.get('id')) || null);
    }
    if (req.method === 'GET' && url.pathname === '/api/backup-file') {
      const inst = find(url.searchParams.get('id'));
      const name = url.searchParams.get('name');
      if (!inst || !listBackups(inst).some((b) => b.name === name)) return send(res, 404, { error: 'Skedari nuk u gjet.' });
      const file = path.join(backupDir(inst), name);
      res.writeHead(200, { 'Content-Type': 'application/sql', 'Content-Length': fs.statSync(file).size, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      res.on('error', () => stream.destroy());
      return stream.pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
      const inst = find(url.searchParams.get('id'));
      if (!inst || !inst.root) return send(res, 404, { error: 'Instalimi nuk u gjet.' });
      const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="diagnostika-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.txt"`, 'Cache-Control': 'no-store' });
      return res.end(await diagnostics(inst));
    }
    if (req.method === 'POST') statusShared.promise = null;
    if (req.method === 'POST' && url.pathname.startsWith('/api/') && url.pathname !== '/api/backup') {
      if (req.headers['x-manager-key'] !== SESSION_KEY) return send(res, 403, { error: 'forbidden' });
      const inst = find(url.searchParams.get('id'));
      if (!inst) return send(res, 404, { error: 'Instalimi nuk u gjet.' });
      if (url.pathname === '/api/open-folder') {
        needLocal(inst);
        const name = url.searchParams.get('name');
        const target = name && listBackups(inst).some((b) => b.name === name) ? path.join(backupDir(inst), name) : null;
        fs.mkdirSync(backupDir(inst), { recursive: true });
        spawn('explorer.exe', target ? ['/select,' + target] : [backupDir(inst)], { detached: true, stdio: 'ignore' }).unref();
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/secrets') {
        // The settings and secrets of this installation, for the "Te dhenat" page (the owner's own computer; POST with the run key, never in /api/status).
        needLocal(inst);
        let env = {};
        try { env = readEnv(path.join(inst.root, '.env')); } catch { /* none */ }
        const items = Object.entries(env).map(([key, value]) => ({ key, value }));
        // The installation's own GitHub token (encrypted file); never the signed-in gh's token.
        let github = '';
        try {
          github = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
            `$f = ${q(path.join(inst.root, 'github.token'))}; if (Test-Path $f) { Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String((Get-Content $f -Raw).Trim()), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)) }`]);
        } catch { /* none */ }
        let tunnel = '';
        try { tunnel = fs.readFileSync(path.join(process.env.ProgramData || 'C:\\ProgramData', 'cloudflared', 'token'), 'utf8').trim(); } catch { /* none */ }
        return send(res, 200, { env: items, github: github.trim(), tunnel });
      }
      if (url.pathname === '/api/backup-delete') {
        // Only a file that is in the installation's backup list can be deleted (the name is never used as a path).
        needLocal(inst);
        const name = url.searchParams.get('name');
        const found = name && listBackups(inst).find((b) => b.name === name);
        if (!found) return send(res, 404, { error: 'Backup-i nuk u gjet.' });
        fs.unlinkSync(path.join(backupDir(inst), found.name));
        return send(res, 200, { ok: true, left: listBackups(inst).length });
      }
      if (url.pathname === '/api/backup-restore') {
        // Restore = the same import as a dump file, but only from a file in the installation's backup list (it makes a safety backup first).
        needLocal(inst);
        const name = url.searchParams.get('name');
        const found = name && listBackups(inst).find((b) => b.name === name);
        if (!found) return send(res, 404, { error: 'Backup-i nuk u gjet.' });
        return send(res, 200, runImport(inst, found.name, fs.readFileSync(path.join(backupDir(inst), found.name), 'utf8')));
      }
      if (url.pathname === '/api/notify') {
        needLocal(inst);
        let body = ''; for await (const c of req) { body += c; if (body.length > 2000) break; }
        let j = {}; try { j = JSON.parse(body); } catch { /* none */ }
        return send(res, 200, setNotify(inst, j.on, j.target));
      }
      if (url.pathname === '/api/notify-test') {
        needLocal(inst);
        const n = notifyOf(inst);
        try { await sendNotify(n.target, 'Provë nga HRSystem Dashboard', (inst.name || '') + ': njoftimet punojnë.'); } catch (e) { return send(res, 400, { error: e.message }); }
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/offsite') {
        needLocal(inst);
        let body = ''; for await (const c of req) { body += c; if (body.length > 2000) break; }
        let j = {}; try { j = JSON.parse(body); } catch { /* none */ }
        try { return send(res, 200, setOffsite(inst, j.on, j.path)); } catch (e) { return send(res, 400, { error: e.message }); }
      }
      if (url.pathname === '/api/offsite-sync') {
        needLocal(inst);
        if (!offsiteOf(inst).path) return send(res, 400, { error: 'Zgjidh fillimisht folderin.' });
        const r = await syncOffsite(inst, true);
        return r && r.ok === false ? send(res, 400, { error: r.error }) : send(res, 200, r);
      }
      if (url.pathname === '/api/dashboard-password') {
        let body = ''; for await (const c of req) { body += c; if (body.length > 1000) break; }
        let j = {}; try { j = JSON.parse(body); } catch { /* none */ }
        try { setDashboardPassword(j.password); } catch (e) { return send(res, 400, { error: e.message }); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(SIGN_IN ? { 'Set-Cookie': `mgr=${COOKIE}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` } : { 'Set-Cookie': 'mgr=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }) });
        return res.end(JSON.stringify({ password: SIGN_IN }));
      }
      if (url.pathname === '/api/versions') return send(res, 200, await versionsOf(inst));
      if (url.pathname === '/api/rollback') {
        const to = String(url.searchParams.get('to') || '');
        if (url.searchParams.get('source') === 'repo') { if (!/^\d+\.\d+\.\d+$/.test(to)) return send(res, 400, { error: 'Version i pavlefshëm.' }); return send(res, 200, rollbackRepo(inst, to, url.searchParams.get('backup') || '')); }
        return send(res, 200, rollbackLocal(inst, to, url.searchParams.get('backup') || ''));
      }
      if (url.pathname === '/api/unpin') { needLocal(inst); savePin(inst, null); latestCache.delete(inst.id); return send(res, 200, { ok: true }); }
      if (url.pathname === '/api/update') return send(res, 200, runUpdate(inst));
      if (url.pathname === '/api/autostart') { needLocal(inst); return send(res, 200, { items: await setAutostart(inst, String(url.searchParams.get('item') || 'all'), url.searchParams.get('on') !== '0') }); }
      if (url.pathname === '/api/auto-backup') { needLocal(inst); const q = url.searchParams; return send(res, 200, setAutoBackup(inst, (q.get('backup') ?? q.get('on')) !== '0', q.has('hour') ? Number(q.get('hour')) : undefined, q.has('keep') ? Number(q.get('keep')) : undefined, q.has('update') ? q.get('update') !== '0' : undefined)); }
      if (url.pathname === '/api/dashboard-update') return send(res, 200, await updateDashboard());
      if (url.pathname === '/api/github-token') {
        // The read-only GitHub token for updates, typed on this computer (never sent anywhere but stored encrypted by the installation's own tool).
        needLocal(inst);
        let body = '';
        for await (const c of req) { body += c; if (body.length > 2000) break; }
        let given = '';
        try { given = String(JSON.parse(body).token || '').trim(); } catch { /* wrong body */ }
        if (!/^[A-Za-z0-9_]{20,}$/.test(given)) return send(res, 400, { error: 'Tokeni nuk duket i sakte (ngjite sic e jep GitHub).' });
        const common = path.join(inst.root, 'hr-common.ps1');
        if (!fs.existsSync(common)) return send(res, 400, { error: 'hr-common.ps1 nuk u gjet te ' + inst.root });
        await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `. ${q(common)}; Save-GitHubToken $env:HR_NEW_TOKEN`], { HR_NEW_TOKEN: given, HRSYSTEM_ROOT: inst.root, HRSYSTEM_DATA: inst.data });
        tokens.delete(inst.root || '');
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/tunnel-remove') return send(res, 200, removeTunnel(inst));
      if (url.pathname === '/api/tunnel-token') {
        let body = '';
        for await (const c of req) { body += c; if (body.length > 4000) break; }
        let given = '';
        try { given = String(JSON.parse(body).token || ''); } catch { /* wrong body */ }
        return send(res, 200, runTunnel(inst, given));
      }
      if (url.pathname === '/api/quick-tunnel') return send(res, 200, url.searchParams.get('do') === 'stop' ? stopQuick(inst) : await startQuick(inst));
      if (url.pathname === '/api/system') return send(res, 200, await systemAction(inst, url.searchParams.get('do')));
      if (url.pathname === '/api/open') {
        needLocal(inst);
        let env = {};
        try { env = readEnv(path.join(inst.root, '.env')); } catch { /* none */ }
        const entry = pathsOf(inst, env).find((e) => e.key === url.searchParams.get('what'));
        if (!entry) return send(res, 404, { error: 'Shtegu nuk u gjet.' });
        fs.mkdirSync(entry.file ? path.dirname(entry.path) : entry.path, { recursive: true });
        spawn('explorer.exe', entry.file ? ['/select,' + entry.path] : [entry.path], { detached: true, stdio: 'ignore' }).unref();
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/developer-open') {
        // Opens /developer already unlocked: the dashboard sends the SETUP_TOKEN (from .env) to the application on this PC and hands the
        // session cookie to the browser. Cookies ignore the port, so the cookie set for 127.0.0.1 here is also sent to 127.0.0.1:<app port>.
        needLocal(inst);
        const env = readEnv(path.join(inst.root, '.env'));
        if (!env.SETUP_TOKEN) return send(res, 400, { error: 'SETUP_TOKEN mungon te .env.' });
        const port = env.PORT || 3000;
        const base = 'http://127.0.0.1:' + port;
        const r = await fetch(base + '/api/developer/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ token: env.SETUP_TOKEN }), signal: AbortSignal.timeout(8000) });
        if (!r.ok) return send(res, 400, { error: r.status === 429 ? 'Shumë tentativa, provo pas pak.' : 'Aplikacioni nuk e pranoi tokenin (kod ' + r.status + ').' });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Set-Cookie': r.headers.getSetCookie() });
        return res.end(JSON.stringify({ url: base + '/developer' }));
      }
      if (url.pathname === '/api/setup-link') {
        needLocal(inst);
        const env = readEnv(path.join(inst.root, '.env'));
        if (!env.SETUP_TOKEN) return send(res, 400, { error: 'SETUP_TOKEN mungon te .env.' });
        return send(res, 200, { url: 'http://localhost:' + (env.PORT || 3000) + '/setup#token=' + env.SETUP_TOKEN });
      }
      if (url.pathname === '/api/uninstall') {
        needLocal(inst);
        const bat = uninstallerOf(inst);
        if (!bat) return send(res, 400, { error: 'Uninstall.bat nuk u gjet.' });
        // A separate console window: the uninstaller asks its questions there and removes this dashboard too.
        spawn('cmd.exe', ['/c', 'start', 'HRSystem Uninstall', 'cmd.exe', '/c', bat], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/import') {
        const chunks = [];
        let size = 0;
        for await (const c of req) { size += c.length; if (size > 300 * 1024 * 1024) return send(res, 413, { error: 'Skedari eshte shume i madh (max 300 MB).' }); chunks.push(c); }
        const name = path.basename(url.searchParams.get('name') || 'databaza.sql');
        if (!/\.sql$/i.test(name)) return send(res, 400, { error: 'Zgjidh nje skedar .sql' });
        return send(res, 200, runImport(inst, name, Buffer.concat(chunks).toString('utf8')));
      }
      if (url.pathname === '/api/sql') {
        const chunks = [];
        let size = 0;
        for await (const c of req) { size += c.length; if (size > 50 * 1024 * 1024) return send(res, 413, { error: 'Skedari eshte shume i madh (max 50 MB).' }); chunks.push(c); }
        const name = path.basename(url.searchParams.get('name') || 'skedar.sql');
        if (!/\.sql$/i.test(name)) return send(res, 400, { error: 'Zgjidh nje skedar .sql' });
        return send(res, 200, runSql(inst, name, Buffer.concat(chunks).toString('utf8')));
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 400, { error: e.message }); // our own checks throw readable messages: a bad request, not a crash
  }
});

// In an installation (the folder above manager/ has current.txt) the system picks a free port itself. The chosen address is written to
// dashboard-url.txt there: the installer, the shortcut and Dashboard.bat read it. The same port is tried again at the next start
// (so the address stays the same) and if it is taken a new free one is chosen.
const INSTALLED = fs.existsSync(path.join(path.dirname(HERE), 'current.txt'));
const URL_FILE = path.join(path.dirname(HERE), 'dashboard-url.txt');
function savedPort() {
  try { return Number(new URL(fs.readFileSync(URL_FILE, 'utf8').trim()).port) || 0; } catch { return 0; }
}
function listen(port) {
  const onError = (e) => {
    if (e.code === 'EADDRINUSE' && port !== 0) listen(0);
    else { console.error('HRSystem Dashboard: ' + e.message); process.exit(1); }
  };
  server.once('error', onError);
  server.listen(port, '127.0.0.1', () => {
    server.removeListener('error', onError);
    const address = `http://127.0.0.1:${server.address().port}`;
    if (INSTALLED) {
      try { fs.writeFileSync(URL_FILE, address); } catch { /* read-only folder */ }
      // The desktop shortcut made by the setup must follow the address, or it opens a port nobody listens on.
      for (const dir of [path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'), path.join(process.env.USERPROFILE || '', 'Desktop')]) {
        const file = path.join(dir, 'HRSystem Dashboard.url');
        try { if (fs.existsSync(file)) fs.writeFileSync(file, `[InternetShortcut]\r\nURL=${address}\r\n`); } catch { /* no rights */ }
      }
    }
    console.log(`HRSystem Dashboard: ${address}  (${path.basename(CONFIG)}); sign-in: ${SIGN_IN ? 'on (key file)' : 'off'}`);
  });
}
listen(PORT_FORCED ?? (INSTALLED ? savedPort() : 3500));

// An update of this file (a new dashboard from update/setup) must not leave the old code running: when server.mjs changes on disk the
// dashboard starts itself again (same user and rights, same port) and ends. Checked every 5 s.
const SELF = fileURLToPath(import.meta.url);
let selfStamp = 0;
try { selfStamp = fs.statSync(SELF).mtimeMs; } catch { /* none */ }
setInterval(() => {
  let now = 0;
  try { now = fs.statSync(SELF).mtimeMs; } catch { return; }
  if (!selfStamp || now === selfStamp) return;
  selfStamp = now;
  const relaunch = () => { startGuard(); try { spawn(process.execPath, [SELF], { cwd: HERE, detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* stays as it is */ } process.exit(0); };
  const timer = setTimeout(relaunch, 3000);
  server.close(() => { clearTimeout(timer); relaunch(); });
  server.closeAllConnections?.();
}, 5000).unref();
