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
// In an installation the port is fixed (3500, see pickPort); MANAGER_PORT forces one, and on a development PC (not installed) it is 3700.
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
// The sign-in page (only when a dashboard password is set): same type, colours and motion as the dashboard; the button shows a spinner while the key is checked.
const LOGIN_HTML = `<!doctype html><html lang="sq"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HRSystem Dashboard</title><style>
:root{color-scheme:light dark;--bg:#f3f5f9;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#4f46e5;--bad:#b91c1c;--badbg:#fee2e2;--out:cubic-bezier(.23,1,.32,1)}
@media(prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#131a2e;--text:#e5e9f4;--muted:#8b97b1;--line:#222c47;--accent:#818cf8;--bad:#f87171;--badbg:#3f1519}button{color:#0b1020!important}button i{border-color:#0b1020!important;border-right-color:transparent!important}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:14px/1.55 "Anthropic Sans","Styrene B",ui-sans-serif,system-ui,-apple-system,"Segoe UI Variable Text","Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
form{width:min(360px,92vw);display:grid;gap:14px;padding:28px 26px 24px;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 44px rgba(2,6,23,.1);animation:rise .34s var(--out) both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
.logo{width:auto;height:46px;display:block;object-fit:contain}
h1{margin:6px 0 0;font-size:20px;font-weight:600;letter-spacing:-.02em}p{margin:0;color:var(--muted);font-size:12.5px}
input{font:inherit;height:40px;padding:0 13px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);outline:none;transition:border-color .15s var(--out),box-shadow .15s var(--out)}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 24%,transparent)}
input.bad{border-color:var(--bad)}
button{font:inherit;font-weight:600;height:40px;border:0;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform .14s var(--out),filter .15s}
@media(hover:hover){button:not(:disabled):hover{filter:brightness(1.08)}}
button:not(:disabled):active{transform:scale(.97)}button:disabled{opacity:.7;cursor:default}
button i{display:none;width:14px;height:14px;border:2px solid #fff;border-right-color:transparent;border-radius:50%;animation:spin .7s linear infinite}button.busy i{display:block}
@keyframes spin{to{transform:rotate(360deg)}}
#e{min-height:19px;color:var(--bad);font-size:13px;opacity:0;transform:translateY(-3px);transition:opacity .15s,transform .15s var(--out)}#e.on{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body><form id="f"><img class="logo" alt="" aria-hidden="true" src="data:image/png;base64,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"><h1>HRSystem Dashboard</h1><p>Shkruaj fjalëkalimin për të hyrë.</p><input id="k" type="password" autocomplete="off" placeholder="Fjalëkalimi i dashboard-it" autofocus required aria-describedby="e"><button id="b"><i></i><span id="bt">Hyr</span></button><p id="e" role="alert"></p><p>Harrove fjalëkalimin? Fshi skedarin manager\\dashboard.key (vetëm administratori).</p></form><script>
f.onsubmit=async function(ev){ev.preventDefault();b.disabled=true;b.classList.add("busy");bt.textContent="Po hyhet...";e.className="";k.classList.remove("bad");
var r;try{r=await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:k.value})})}catch(x){r={ok:false,status:0}}
if(r.ok){bt.textContent="Po hapet...";location.reload();return}
b.disabled=false;b.classList.remove("busy");bt.textContent="Hyr";k.classList.add("bad");e.textContent=r.status===429?"Shumë provime. Prit një minutë.":r.status===0?"Dashboard-i nuk përgjigjet.":"Fjalëkalimi nuk është i saktë.";e.className="on";k.select()};
k.oninput=function(){k.classList.remove("bad");e.className=""};
var h=/[#&]key=([0-9a-f]+)/.exec(location.hash);if(h){history.replaceState(null,"",location.pathname);k.value=h[1];f.requestSubmit()}</script></body></html>`;

// A random key per run: every action that changes something (backup) must carry it, so a web page cannot trigger it.
const SESSION_KEY = crypto.randomBytes(24).toString('hex');
const BOOT_ID = crypto.createHash('sha256').update(SESSION_KEY).digest('hex').slice(0, 10); // shown to the page, not the key itself
// A broken connection or an error in one request must never stop the dashboard: it is logged and the dashboard keeps running.
// Where the server is (owner, 2026-10-22): the public address, the country and the Cloudflare data centre that answers for it, read from Cloudflare's own trace page
// (no third party gets the address); refreshed every 10 minutes in the background.
const locSeen = { at: 0, value: null, busy: false };
function serverLocation() {
  if (Date.now() - locSeen.at > 600000 && !locSeen.busy) {
    locSeen.busy = true;
    fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(8000), cache: 'no-store' }).then((r) => r.text()).then((t) => {
      const m = Object.fromEntries(t.split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
      if (m.ip) locSeen.value = { ip: m.ip, country: m.loc || '', colo: m.colo || '', warp: m.warp === 'on' || m.warp === 'plus' };
    }).catch(() => {}).finally(() => { locSeen.at = Date.now(); locSeen.busy = false; });
  }
  return locSeen.value ? { ...locSeen.value, host: os.hostname(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone } : { host: os.hostname(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
// ======================= Error logs (owner, 2026-10-22) =======================
// Every runtime error of the dashboard (an unexpected exception, a request that failed, an action that ended in an error) is written, one JSON line each, to
// dashboard-errors.log next to server.mjs (kept small: over 1 MB only the last 1500 lines stay). The page "Gabimet" shows it, with the logs of the application and of the updater.
const ERR_FILE = path.join(HERE, 'dashboard-errors.log');
function logError(where, err, extra) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const entry = { at: new Date().toISOString(), where, message: String(e.message).slice(0, 500), stack: (e.stack || '').split('\n').slice(1, 4).map((s) => s.trim()).join(' | ').slice(0, 400), ...(extra || {}) };
    fs.appendFileSync(ERR_FILE, JSON.stringify(entry) + '\n');
    if (fs.statSync(ERR_FILE).size > 1048576) fs.writeFileSync(ERR_FILE, fs.readFileSync(ERR_FILE, 'utf8').split('\n').filter(Boolean).slice(-1500).join('\n') + '\n');
  } catch { /* the log must never break the dashboard */ }
}
function readErrorEntries(limit = 300) {
  try { return fs.readFileSync(ERR_FILE, 'utf8').split('\n').filter(Boolean).slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return { at: '', where: '?', message: l }; } }); } catch { return []; }
}
let errCount = { at: 0, n: 0 };
function errorsLastDay() {
  if (Date.now() - errCount.at < 30000) return errCount.n;
  const since = Date.now() - 86400000;
  errCount = { at: Date.now(), n: readErrorEntries(1500).filter((e) => Date.parse(e.at) >= since).length };
  return errCount.n;
}
// The tail of a text log; PowerShell's redirected logs are UTF-16 (null bytes), the others UTF-8.
function tailText(file, maxBytes = 262144) {
  try {
    const st = fs.statSync(file), fd = fs.openSync(file, 'r');
    try {
      const len = Math.min(st.size, maxBytes), buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      const text = buf.includes(0) ? buf.subarray((st.size - len) % 2 ? 1 : 0).toString('utf16le') : buf.toString('utf8');
      return text.replace(/^\uFEFF/, '');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}
const LOG_FILES = (inst) => ({ app: path.join(inst.root, 'HRSystem-Server.log'), updater: path.join(inst.root, 'Updater.log'), dashboardlog: path.join(inst.root, 'Dashboard.log') });
function errorsOf(inst, source, limit) {
  if (source === 'dashboard') return { source, entries: readErrorEntries(limit), file: ERR_FILE };
  const file = (LOG_FILES(inst))[source];
  if (!file) return null;
  const lines = tailText(file).split(/\r?\n/).filter((l) => l.trim()).slice(-limit).reverse();
  let updated = null; try { updated = fs.statSync(file).mtime.toISOString(); } catch { /* none */ }
  return { source, lines, file, updated };
}
process.on('uncaughtException', (e) => { console.error('uncaughtException:', e && e.stack ? e.stack : e); logError('uncaughtException', e); });
process.on('unhandledRejection', (e) => { console.error('unhandledRejection:', e && e.stack ? e.stack : e); logError('unhandledRejection', e); });
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
    // The name shown (page, menu, phone messages) is the company's repository name without the "HRSystem-" prefix (HRSystem-ReginaCenter -> ReginaCenter), never "HRSystem (ky PC)".
    listed.unshift({ id: 'hrsystem', name: upd.repo ? String(upd.repo).split('/').pop().replace(/^HRSystem-/i, '') || 'HRSystem' : 'HRSystem', root: std, data: std + 'Data', repo: upd.repo, channel: upd.channel || 'stable', task: 'HRSystem' });
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

// The app zip of a Release: HRSystem-<version>.zip (from 1.0.2) or, in the older Releases, HRSystemV<version>-Hostinger.zip.
const isAppAsset = (a) => /^HRSystem-\d+\.\d+\.\d+\.zip$/.test(a.name) || /-Hostinger\.zip$/.test(a.name);
async function latest(inst) {
  // No repository saved (owner, 2026-10-22: nothing is built in): the GitHub token tells which one it reads.
  if (!inst.repo) {
    try { const tk = await token(inst); const out = tk ? await followTokenRepo(inst, tk) : null; if (out && out.repo) inst.repo = out.repo; else return null; } catch { return null; }
  }
  const t = await token(inst);
  const res = await fetch(`https://api.github.com/repos/${inst.repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'regina-manager', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return { error: `GitHub ${res.status}` };
  const releases = (await res.json()).filter((r) => !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name));
  const pick = inst.channel === 'test' ? releases[0] : releases.find((r) => !r.prerelease);
  if (!pick) return { error: 'Nuk ka Release' };
  const asset = pick.assets.find(isAppAsset);
  // The notes of the new version, and of every version between the installed one and it (newest first, at most 5, each cut at 4000 characters).
  // A local copy of a Release page's text only: the dashboard never writes to GitHub.
  const cur = installed(inst);
  const have = cur && !cur.error ? cur.version : null;
  const newest = pick.tag_name.slice(1);
  const notes = releases
    .filter((r) => (inst.channel === 'test' || !r.prerelease) && cmp(r.tag_name.slice(1), newest) <= 0 && (!have || cmp(r.tag_name.slice(1), have) > 0))
    .slice(0, 5)
    .map((r) => ({ version: r.tag_name.slice(1), title: String(r.name || '').slice(0, 120), body: String(r.body || '').replace(/\r/g, '').trim().slice(0, 4000) }))
    .filter((n) => n.body);
  return {
    version: newest,
    prerelease: pick.prerelease,
    published: pick.published_at,
    build: asset ? `${asset.id}:${asset.updated_at}` : null,
    notes,
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
  try { return await backupRaw(inst); } catch (e) { addHistory(inst, { title: 'Backup', ok: false, detail: String(e.message).slice(0, 160) }); notify(inst, 'Backup-i dështoi', String(e.message).slice(0, 160), 'error'); throw e; }
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
    return { ...b, version: v, tested: (cur.backupTests || {})[b.name] || null };
  });
}
setInterval(() => { for (const inst of instances()) { if (inst.root) { try { recordVersion(inst); } catch { /* next time */ } } } }, 60000).unref();
setInterval(() => { for (const inst of instances()) if (inst.root) procStats(inst).catch(() => {}); }, 20000).unref(); // keeps the totals of the day even when no page is open

// ---- Jobs (update, SQL): run in the background, the page polls their output ----
const jobs = new Map(); // instance id -> { title, state: 'running' | 'ok' | 'error', lines, started }
const clean = (t) => t.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');

function startJob(inst, title, launch, by = 'manual') {
  const old = jobs.get(inst.id);
  if (old && old.state === 'running') throw new Error('Nje veprim po ekzekutohet: "' + old.title + '". Prit te mbaroje.');
  const job = { title, state: 'running', lines: [], started: Date.now(), by };   // by: 'manual' (a button) or 'auto' (the night job)
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
    // npm_config_loglevel: a new npm prints "npm warn ..." on stderr and the installed (older) updater.ps1 treats any such text as an error; only real errors are printed.
    const env = { ...process.env, HRSYSTEM_ROOT: inst.root, HRSYSTEM_DATA: inst.data, npm_config_loglevel: 'error' };
    if (inst.task) env.HRSYSTEM_TASK = inst.task;
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...(zip ? ['-Zip', zip] : [])], { env, windowsHide: true });
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    p.on('error', (e) => { add('GABIM: ' + e.message); resolve(false); });
    p.on('close', (code) => resolve(code === 0));
  });
}
function runUpdate(inst, by = 'manual') {
  needLocal(inst);
  if (!fs.existsSync(path.join(inst.root, 'updater.ps1'))) throw new Error('updater.ps1 nuk u gjet te ' + inst.root);
  return startJob(inst, 'Perditesim', (add) => spawnUpdater(inst, add), by);
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
    const a = r.assets.find(isAppAsset);
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

function mysqlRun(inst, cfg, sqlFile, add, db) {
  return new Promise((resolve, reject) => {
    const p = spawn(mysqlPath(), [`--user=${cfg.DB_USER}`, '--protocol=TCP', `--host=${cfg.DB_HOST}`, `--port=${cfg.DB_PORT}`, '--default-character-set=utf8mb4', db || cfg.DB_NAME], { env: { ...process.env, MYSQL_PWD: cfg.DB_PASSWORD }, windowsHide: true });
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
// sees with the time (domainsSeen). One tunnel can carry several names (self, app, test ...), so all of them are shown. A name is never forgotten
// by itself, not even when it does not open (owner, 2026-10-22): only the owner removes it (Hiq). A temporary address (quick tunnel) is kept apart
// from the learning, but it is shown in the same list.
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
    if (JSON.stringify(known) !== JSON.stringify(settings.domainsSeen) || settings.domainSeen !== undefined || settings.domain !== undefined) {
      settings.domainsSeen = known; delete settings.domainSeen; delete settings.domain; // a domain typed by hand is no longer used (owner, 2026-10-22: only automatic)
      fs.writeFileSync(settingsFile(inst), JSON.stringify(settings, null, 2));
    }
  } catch { /* older application without the route, or it is stopped */ }
}
setInterval(() => { try { for (const inst of instances()) if (inst.local && inst.root) learnDomains(inst); } catch { /* none */ } }, 15000).unref();

const domainHealth = new Map(); // url -> { at, ok }
const tunnelSeen = { at: 0, list: '' }; // the list of cloudflared processes, 10 s
// One slow or lost answer is not "down" (the lamp turned red for 15-45 s after a single timeout): a timeout, or a 5xx from the tunnel, is asked
// once more with a longer wait; a refused connection or a 4xx answer is final at once.
async function healthOk(url, first = 5000, second = 10000) {
  for (const wait of [first, second]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(wait), cache: 'no-store' });
      if (r.ok) return true;
      if (r.status < 500) return false;
    } catch (e) { if (!(e && (e.name === 'TimeoutError' || e.name === 'AbortError'))) return false; }
  }
  return false;
}
async function accessOf(inst, env) {
  const settings = readSettings(inst);
  const isPublic = (o) => o && !o.includes('localhost') && !o.includes('127.0.0.1');
  // Only automatic: the names that were seen (in alphabetical order), then the one from the .env.
  const hidden = new Set(settings.domainsHidden || []);
  const names = [...Object.keys(settings.domainsSeen || {}).sort(), env.APP_ORIGIN].filter(isPublic).filter((o, i, all) => all.indexOf(o) === i).filter((o) => !hidden.has(o));
  const domains = await Promise.all(names.map(async (u) => {
    let ok = false;
    const seen = domainHealth.get(u);
    if (seen && Date.now() - seen.at < (seen.ok ? 45000 : 15000)) return { url: u, ok: seen.ok }; // a red answer is asked again sooner than a green one
    ok = await healthOk(u.replace(/[/]$/, '') + '/api/health');
    domainHealth.set(u, { at: Date.now(), ok });
    return { url: u, ok };
  }));
  // The temporary address is one more address in the same list: it stays listed (as "nuk hapet") when its process is gone, until the owner removes it.
  const quickNow = quickUrlOf(inst) || (settings.quickLast && settings.quickLast.url) || '';
  if (quickNow && !hidden.has(quickNow) && !domains.some((d) => d.url === quickNow)) {
    let ok = false;
    const seenQ = domainHealth.get(quickNow);
    if (seenQ && Date.now() - seenQ.at < (seenQ.ok ? 45000 : 15000)) ok = seenQ.ok;
    else { ok = await healthOk(quickNow + '/api/health'); domainHealth.set(quickNow, { at: Date.now(), ok }); }
    domains.push({ url: quickNow, ok, temporary: true });
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
function appScripts(inst) {
  const task = inst.task || 'HRSystem';
  const root = path.resolve(inst.root); // backslashes, as in the command lines of the processes
  // The application is kept alive by a launcher (start-hrsystem.ps1) that starts node again 3 s after it ends, so stopping only node (or only the task)
  // never worked when the launcher was not a task. Stop = the task, then the LAUNCHER, then node. Start = the task if there is one, otherwise a new
  // launcher that does not depend on the dashboard (so it survives the dashboard's own restarts).
  const stop = `Stop-ScheduledTask -TaskName ${q(task)} -ErrorAction SilentlyContinue; ` +
    `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*start-hrsystem.ps1*' -and $_.CommandLine -like ${q('*' + root + '*')} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; ` +
    `Start-Sleep -Seconds 1; ` +
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like ${q('*' + root + '*server.mjs*')} -and $_.CommandLine -notlike '*\\manager\\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  const launcher = path.join(root, 'start-hrsystem.ps1');
  const start = `$t = Get-ScheduledTask -TaskName ${q(task)} -ErrorAction SilentlyContinue; if ($t -and $t.Settings.Enabled) { Start-ScheduledTask -TaskName ${q(task)} } else { ` + // a task switched off in "Nisja me Windows" must not stop a manual Start
    `$running = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*start-hrsystem.ps1*' -and $_.CommandLine -like ${q('*' + root + '*')} }; ` +
    `if (-not $running) { $s = New-CimInstance -ClassName Win32_ProcessStartup -Namespace root/cimv2 -ClientOnly -Property @{ ShowWindow = [uint16]0 }; Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${q('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + launcher + '"')}; CurrentDirectory = ${q(root)}; ProcessStartupInformation = [CimInstance]$s } | Out-Null } }`;
  return { stop, start };
}
async function systemAction(inst, action) {
  needLocal(inst);
  const { stop, start } = appScripts(inst);
  const command = action === 'stop' ? stop : action === 'start' ? start : action === 'restart' ? `${stop}; Start-Sleep -Seconds 2; ${start}` : null;
  if (!command) throw new Error('Veprim i panjohur.');
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
  // A Stop pressed by the owner is remembered, so the watcher does not start the application again; Start / Restart forget it.
  { const cur = readSettings(inst); if (action === 'stop') cur.manualStop = Date.now(); else delete cur.manualStop; settingsWrite(inst, cur); }
  // The phone is told what was done and by whom (owner, 2026-10-22), and the history keeps it.
  { const what = { stop: ['Aplikacioni u ndal manualisht', 'Është ndalur me butonin Stop nga dashboard-i.'], start: ['Aplikacioni u ndez manualisht', 'Është ndezur me butonin Start nga dashboard-i.'], restart: ['Aplikacioni u rindez manualisht', 'Është rindezur me butonin Restart nga dashboard-i.'] }[action];
    if (what && !systemAction.quiet) { notify(inst, what[0], what[1], 'info'); addHistory(inst, { title: what[0], ok: true, detail: '' }); } }
  return { ok: true };
}

// The Cloudflare Tunnel (opens the application from the internet with the owner's own address): the same steps as the installer.
function runTunnel(inst, rawToken) {
  needLocal(inst);
  { const cur = readSettings(inst); delete cur.domainsHidden; settingsWrite(inst, cur); } // a new tunnel: the names it carries are shown again
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

// ---- The programs the system runs on: Node.js (runs the application) and cloudflared (the Cloudflare Tunnel program).
// Versions are read from the PC; the newest ones from nodejs.org and GitHub (cached 10 min). Node.js is only moved to the newest release of the
// SAME major (a new major could break the application: that stays a decision of the owner); its installer is checked against the SHA-256 list of
// nodejs.org before it runs. cloudflared is updated with winget (the way it was installed), its Windows service is stopped and started around it.
// HR_TOOLS_DRY=1 prints the steps without doing anything (tests).
const toolsCache = { at: 0, data: null };
const verCmp = (a, b) => {
  const x = String(a || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0), y = String(b || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
};
async function fetchJson(url, ms = 8000) {
  const r = await fetch(url, { headers: { 'User-Agent': 'HRSystem-Dashboard', Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function toolsInfo() {
  if (toolsCache.data && Date.now() - toolsCache.at < 600000) return toolsCache.data;
  const out = { node: { installed: '', latest: '', ltsLatest: '', update: false, error: '' }, cloudflared: { installed: '', latest: '', update: false, error: '' }, winget: false };
  out.node.installed = await run('node', ['--version']).then((s) => s.replace(/^v/, '')).catch(() => '');
  try {
    const list = await fetchJson('https://nodejs.org/dist/index.json', 10000);
    const major = out.node.installed.split('.')[0];
    const same = list.find((x) => major && String(x.version).startsWith('v' + major + '.'));
    out.node.latest = same ? String(same.version).replace(/^v/, '') : '';
    const lts = list.find((x) => x.lts);
    out.node.ltsLatest = lts ? String(lts.version).replace(/^v/, '') : '';
  } catch (e) { out.node.error = 'Nuk u kontrollua në internet.'; }
  out.node.update = !!(out.node.installed && out.node.latest && verCmp(out.node.latest, out.node.installed) > 0);
  const cf = cloudflaredPath();
  if (cf) out.cloudflared.installed = await run(cf, ['--version']).then((s) => (/(\d{4}\.\d+\.\d+)/.exec(s) || [])[1] || '').catch(() => '');
  try {
    const j = await fetchJson('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', 10000);
    out.cloudflared.latest = String(j.tag_name || '').replace(/^v/, '');
  } catch (e) { out.cloudflared.error = 'Nuk u kontrollua në internet.'; }
  out.cloudflared.update = !!(out.cloudflared.installed && out.cloudflared.latest && verCmp(out.cloudflared.latest, out.cloudflared.installed) > 0);
  out.winget = await run('where.exe', ['winget']).then(() => true).catch(() => false);
  toolsCache.data = out; toolsCache.at = Date.now();
  return out;
}

// Two steps, so the owner chooses WHEN the system is touched: (1) "Shkarko": the installer is downloaded now into <install folder>\tools-staging and checked
// (SHA-256: nodejs.org's SHASUMS256.txt for Node.js, the digest GitHub publishes for cloudflared); nothing on the PC changes. (2) The installation, now or at a
// time the owner sets (`toolPlans` in dashboard-settings.json, checked every minute): Node.js = stop the application, msiexec /qn, start it again;
// cloudflared = stop its Windows service and the permanent tunnel process (never the quick tunnel), msiexec /qn, start the service.
// A plan older than 6 hours (the dashboard was off at that time) is cancelled instead of running at a random hour.
const TOOL_NAMES = { node: 'Node.js', cloudflared: 'Cloudflare Tunnel' };
const stagingDir = (inst) => path.join(inst.root, 'tools-staging');
const toolPlans = (inst) => readSettings(inst).toolPlans || {};
function saveToolPlan(inst, what, plan) {
  const cur = readSettings(inst);
  cur.toolPlans = cur.toolPlans || {};
  if (plan) cur.toolPlans[what] = plan; else delete cur.toolPlans[what];
  if (!Object.keys(cur.toolPlans).length) delete cur.toolPlans;
  settingsWrite(inst, cur);
}
const plannedOf = (inst, what) => { const p = toolPlans(inst)[what]; return p && p.file && fs.existsSync(p.file) ? p : null; };
const planView = (p) => (p ? { version: p.version, at: p.at || 0, downloadedAt: p.downloadedAt || 0 } : null);
function checkTool(what) { if (what !== 'node' && what !== 'cloudflared') throw new Error('Mjet i panjohur.'); }
const toolsDry = () => process.env.HR_TOOLS_DRY === '1';
function nextNight(hour) { const d = new Date(); d.setHours(hour, 0, 0, 0); if (d.getTime() < Date.now() + 10 * 60000) d.setDate(d.getDate() + 1); return d.getTime(); }
const toolAutoLast = new Map(); // inst:what -> when a download was last started on its own (a failed one is not repeated before 6 hours)

// Where a version is downloaded from and the SHA-256 it must have.
async function toolRelease(what, version) {
  if (what === 'node') {
    const name = `node-v${version}-x64.msi`, base = `https://nodejs.org/dist/v${version}`;
    const txt = await (await fetch(base + '/SHASUMS256.txt', { headers: { 'User-Agent': 'HRSystem-Dashboard' }, signal: AbortSignal.timeout(20000) })).text();
    const line = txt.split(/\r?\n/).find((l) => l.trim().endsWith(' ' + name));
    const sha = line ? line.trim().split(/\s+/)[0].toLowerCase() : '';
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('Nuk u gjet shuma e kontrollit (SHA-256) e skedarit: nuk shkarkohet pa kontroll.');
    return { url: `${base}/${name}`, name, sha };
  }
  const j = await fetchJson('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', 20000);
  const a = (j.assets || []).find((x) => x.name === 'cloudflared-windows-amd64.msi');
  const sha = a ? String(a.digest || '').replace(/^sha256:/i, '').toLowerCase() : '';
  if (!a || !/^[0-9a-f]{64}$/.test(sha)) throw new Error('Nuk u gjet skedari ose shuma e tij e kontrollit (SHA-256): nuk shkarkohet pa kontroll.');
  return { url: a.browser_download_url, name: `cloudflared-${version}-windows-amd64.msi`, sha };
}

// Download to a .part file, check the SHA-256, then rename: a half or a wrong file never carries the final name.
async function downloadVerified(url, file, sha) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = file + '.part';
  const r = await fetch(url, { headers: { 'User-Agent': 'HRSystem-Dashboard' }, redirect: 'follow', signal: AbortSignal.timeout(20 * 60 * 1000) });
  if (!r.ok || !r.body) throw new Error('Shkarkimi dështoi (HTTP ' + r.status + ').');
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let size = 0;
  try {
    for await (const chunk of r.body) { hash.update(chunk); size += chunk.length; if (!out.write(chunk)) await new Promise((res) => out.once('drain', res)); }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  } catch (e) { out.destroy(); fs.rmSync(part, { force: true }); throw e; }
  const got = hash.digest('hex');
  if (got !== sha) { fs.rmSync(part, { force: true }); throw new Error('Kontrolli SHA-256 i skedarit dështoi: asgjë nuk u instalua.'); }
  fs.renameSync(part, file);
  return { size, sha: got };
}

// Step 1. Returns true when the new version is ready in the staging folder (or there is nothing newer).
async function stageTool(inst, what, add) {
  toolsCache.at = 0;
  const info = await toolsInfo();
  const t = info[what];
  if (!t.installed) { add('GABIM: ' + TOOL_NAMES[what] + ' nuk u gjet në këtë kompjuter.'); return false; }
  if (!t.latest) { add('GABIM: nuk u gjet versioni më i ri (interneti ose faqja e burimit nuk përgjigjet).'); return false; }
  if (!t.update) { add('Është i përditësuar (' + t.installed + ').'); return true; }
  const have = plannedOf(inst, what);
  if (have && have.version === t.latest) { add('Versioni ' + t.latest + ' është shkarkuar tashmë.'); return true; }
  add('Versioni i instaluar: ' + t.installed + ' · versioni i ri: ' + t.latest);
  if (toolsDry()) { add('[provë] Do të shkarkohej ' + TOOL_NAMES[what] + ' ' + t.latest + '. Asgjë nuk u ndryshua.'); return true; }
  const rel = await toolRelease(what, t.latest);
  const file = path.join(stagingDir(inst), rel.name);
  add('Po shkarkohet ' + TOOL_NAMES[what] + ' ' + t.latest + ' ...');
  const r = await downloadVerified(rel.url, file, rel.sha);
  add('Skedari u shkarkua (' + Math.max(1, Math.round(r.size / 1048576)) + ' MB) dhe u verifikua (SHA-256).');
  try { for (const f of fs.readdirSync(stagingDir(inst))) if (f !== rel.name && f.startsWith(what === 'node' ? 'node-v' : 'cloudflared-')) fs.rmSync(path.join(stagingDir(inst), f), { force: true }); } catch { /* old files stay */ }
  const plan = { version: t.latest, from: t.installed, file, sha: r.sha, downloadedAt: Date.now() };
  // "Instalo vetë" is on: the installation is set for the next time the owner's hour comes (02:00 unless he chose another).
  const ta = readSettings(inst).toolAuto || {};
  if (ta.install) { plan.at = nextNight(Number.isInteger(ta.hour) && ta.hour >= 0 && ta.hour <= 23 ? ta.hour : 2); add('Instalimi u caktua automatikisht për ' + new Date(plan.at).toLocaleString('sq-AL') + '.'); }
  saveToolPlan(inst, what, plan);
  return true;
}
function toolDownload(inst, what, by = 'manual') {
  needLocal(inst); checkTool(what);
  return startJob(inst, 'Shkarkimi i ' + TOOL_NAMES[what], (add) => stageTool(inst, what, add), by);
}

const nodeResultFile = (inst) => path.join(stagingDir(inst), 'node-result.json');
const nodePendingFile = (inst) => path.join(stagingDir(inst), 'node-pending.json');
const nodeScriptFile = (inst) => path.join(stagingDir(inst), 'node-install.ps1');
const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
function nodeCleanup(inst) { for (const f of [nodeResultFile(inst), nodePendingFile(inst), nodeScriptFile(inst)]) fs.rmSync(f, { force: true }); }
// Installing Node.js closes every node.exe, this dashboard included, so the installation runs in a detached script: it installs, starts the
// application, starts the dashboard again when it is gone, and writes node-result.json. The dashboard reads it while it is alive (the loop below)
// or after it came back (nodeResultTick).
async function nodeInstallDetached(inst, plan, add, by) {
  add('Aplikacioni ndalet për pak çaste ...');
  systemAction.quiet = true; try { await systemAction(inst, 'stop'); } finally { systemAction.quiet = false; }
  nodeCleanup(inst);
  fs.writeFileSync(nodePendingFile(inst), JSON.stringify({ by, version: plan.version, file: plan.file }));
  const port = (server.address() || {}).port || 0;
  const { start } = appScripts(inst);
  const script = [
    "$ErrorActionPreference = 'Continue'",
    "$lines = New-Object System.Collections.Generic.List[string]; $ok = $false; $code = -1",
    "try {",
    "  Start-Sleep -Seconds 2",
    "  $p = Start-Process msiexec.exe -ArgumentList '/i', ('\"' + " + q(plan.file) + " + '\"'), '/qn', '/norestart' -Wait -PassThru",
    "  $code = $p.ExitCode",
    "  if ($code -eq 0) { $ok = $true; $lines.Add('SUKSES: Node.js u instalua.') }",
    "  elseif ($code -eq 3010) { $ok = $true; $lines.Add('SUKSES: Node.js u instalua; hyn plotësisht në fuqi pas rinisjes së kompjuterit.') }",
    "  else { $hint = if (@(5, 1603, 1625, 1730, 1925) -contains $code) { ' Duhen leje administratori: dashboard-i duhet të punojë si administrator.' } else { '' }; $lines.Add('GABIM: Instalimi dështoi (kodi ' + $code + ').' + $hint) }",
    "} catch { $lines.Add('GABIM: ' + $_.Exception.Message) }",
    "try { " + start + "; $lines.Add('Aplikacioni u ndez përsëri.') } catch { $lines.Add('GABIM: aplikacioni nuk u ndez: ' + $_.Exception.Message); $ok = $false }",
    "Start-Sleep -Seconds 6",
    "$up = $false; try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', " + port + "); $c.Close(); $up = $true } catch { }",
    "if (-not $up) { try { $env:MANAGER_PORT = '" + port + "'; Start-Process -FilePath " + q(process.execPath) + " -ArgumentList ('\"' + " + q(SELF) + " + '\"') -WorkingDirectory " + q(HERE) + " -WindowStyle Hidden; $lines.Add('Dashboard-i u ndez përsëri.') } catch { $lines.Add('KUJDES: dashboard-i nuk u ndez vetë: ' + $_.Exception.Message) } }",
    "$json = ConvertTo-Json -InputObject @{ ok = $ok; code = $code; lines = @($lines) } -Compress",
    "[IO.File]::WriteAllText(" + q(nodeResultFile(inst)) + ", $json, (New-Object Text.UTF8Encoding $false))",
  ].join('\r\n');
  fs.writeFileSync(nodeScriptFile(inst), '﻿' + script);
  add('Po instalohet ... (dashboard-i mund të mbyllet e të rindizet vetë për pak çaste)');
  // `start` through cmd: a detached powershell.exe without a console ends at once (tested), and a plain child dies with its parent's job.
  spawn('cmd.exe', ['/c', 'start', '""', '/min', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '"' + nodeScriptFile(inst) + '"'], { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
  const deadline = Date.now() + 15 * 60000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = readJsonFile(nodeResultFile(inst));
    if (!r) continue;
    for (const l of r.lines || []) add(l);
    nodeCleanup(inst);
    toolsCache.at = 0;
    if (r.ok) { saveToolPlan(inst, 'node', null); fs.rmSync(plan.file, { force: true }); }
    return !!r.ok;
  }
  add('GABIM: instalimi nuk dha rezultat brenda 15 minutave.');
  return false;
}
// The dashboard came back after the installation closed it: it reports what the detached script did.
function nodeResultTick() {
  for (const inst of instances()) {
    if (!inst.root || !inst.data) continue;
    const busy = jobs.get(inst.id);
    if (busy && busy.state === 'running') continue;
    const r = readJsonFile(nodeResultFile(inst));
    if (!r) continue;
    const pend = readJsonFile(nodePendingFile(inst)) || {};
    nodeCleanup(inst);
    toolsCache.at = 0;
    if (r.ok) { saveToolPlan(inst, 'node', null); if (pend.file) fs.rmSync(pend.file, { force: true }); }
    const job = { title: 'Përditësimi i Node.js', state: r.ok ? 'ok' : 'error', lines: (r.lines || []).slice(-200), started: Date.now(), ended: Date.now(), by: pend.by || 'manual' };
    jobs.set(inst.id, job);
    try { jobDone(inst, job); } catch { /* history only */ }
  }
}
setInterval(nodeResultTick, 5000).unref();

// Step 2: install now (it downloads first when nothing was downloaded yet), or at the time in the plan (by = 'auto').
function toolInstall(inst, what, by = 'manual') {
  needLocal(inst); checkTool(what);
  return startJob(inst, 'Përditësimi i ' + TOOL_NAMES[what], async (add) => {
    let plan = plannedOf(inst, what);
    if (!plan) { if (!await stageTool(inst, what, add)) return false; plan = plannedOf(inst, what); if (!plan) return true; }
    toolsCache.at = 0;
    const info = await toolsInfo();
    const t = info[what];
    if (t.installed && verCmp(t.installed, plan.version) >= 0) { add('Është i përditësuar (' + t.installed + ').'); saveToolPlan(inst, what, null); fs.rmSync(plan.file, { force: true }); return true; }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(plan.file)).digest('hex');
    if (sha !== plan.sha) { add('GABIM: skedari i shkarkuar është ndryshuar ose dëmtuar; shkarkoje përsëri.'); saveToolPlan(inst, what, null); fs.rmSync(plan.file, { force: true }); return false; }
    add('Versioni i instaluar: ' + t.installed + ' · versioni i ri: ' + plan.version);
    if (toolsDry()) { add('[provë] Do të instalohej ' + TOOL_NAMES[what] + ' ' + plan.version + ' nga ' + plan.file + '. Asgjë nuk u ndryshua.'); return true; }
    const script = [
      "$ErrorActionPreference = 'Stop'",
      ...(what === 'cloudflared' ? [
        "$svc = Get-Service cloudflared -ErrorAction SilentlyContinue",
        "if ($svc) { Write-Host 'Po ndalet shërbimi i tunelit ...'; Stop-Service cloudflared -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }",
        "Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne [int]$env:HR_QUICK_PID } | Stop-Process -Force -ErrorAction SilentlyContinue",
      ] : []),
      "Write-Host 'Po instalohet ...'",
      "$p = Start-Process msiexec.exe -ArgumentList '/i', ('\"' + $env:HR_MSI + '\"'), '/qn', '/norestart' -Wait -PassThru",
      "$code = $p.ExitCode",
      ...(what === 'cloudflared' ? [
        "if ($svc) { Start-Service cloudflared -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3; if ((Get-Service cloudflared).Status -ne 'Running') { Write-Host 'KUJDES: shërbimi i tunelit nuk u ndez; ndize te Veprime > Lidhjet.' } else { Write-Host 'Shërbimi i tunelit u ndez përsëri.' } }",
      ] : []),
      "if ($code -ne 0 -and $code -ne 3010) { $hint = if (@(5, 1603, 1625, 1730, 1925) -contains $code) { ' Duhen leje administratori: dashboard-i duhet të punojë si administrator.' } else { '' }; throw \"Instalimi dështoi (kodi $code).$hint\" }",
      what === 'node'
        ? "if ($code -eq 3010) { Write-Host 'SUKSES: Node.js u instalua; hyn plotësisht në fuqi pas rinisjes së kompjuterit.' } else { Write-Host 'SUKSES: Node.js u instalua.' }"
        : "Write-Host 'SUKSES: cloudflared u përditësua.'",
    ];
    const env = { ...process.env, HR_MSI: plan.file, HR_QUICK_PID: String((quickState(inst) || {}).pid || 0) };
    // Node.js runs this dashboard too: the installer closes it, so the steps after the installation cannot belong to it. A detached script does
    // everything (install, start the application, start the dashboard again if it was closed) and leaves its result in a file that
    // the dashboard reads when it is back (nodeResultTick) or while it is still alive (below).
    if (what === 'node') return nodeInstallDetached(inst, plan, add, by);
    let stopped = false;
    let ok = false;
    try {
      ok = await new Promise((resolve) => {
        // -EncodedCommand (UTF-16 base64) keeps the Albanian letters of the messages; the output is read as UTF-8; one clean error line instead of PowerShell's stack.
        const body = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; try { " + script.join('; ') + " } catch { Write-Host ('GABIM: ' + $_.Exception.Message); exit 1 }";
        const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(body, 'utf16le').toString('base64')], { env, windowsHide: true });
        p.stdout.on('data', (d) => add(d.toString('utf8')));
        p.stderr.on('data', () => { /* -EncodedCommand writes progress as CLIXML here; the errors come through the try/catch above, on stdout */ });
        p.on('error', (e) => { add('GABIM: ' + e.message); resolve(false); });
        p.on('close', (code) => resolve(code === 0));
      });
    } finally {
      if (stopped) { add('Aplikacioni ndizet përsëri ...'); systemAction.quiet = true; try { await systemAction(inst, 'start'); } catch (e) { add('GABIM: aplikacioni nuk u ndez: ' + e.message); ok = false; } finally { systemAction.quiet = false; } }
      toolsCache.at = 0;
    }
    if (ok) { saveToolPlan(inst, what, null); fs.rmSync(plan.file, { force: true }); }
    return ok;
  }, by);
}

// The time of the installation (milliseconds), or null to cancel it. Only for a version that is downloaded already.
function toolSchedule(inst, what, at) {
  needLocal(inst); checkTool(what);
  const plan = plannedOf(inst, what);
  if (!plan) throw new Error('Shkarko fillimisht versionin e ri.');
  if (at === null) { delete plan.at; saveToolPlan(inst, what, plan); return { ok: true, at: 0 }; }
  const ms = Number(at);
  if (!Number.isFinite(ms) || ms < Date.now() + 60000 || ms > Date.now() + 14 * 86400000) throw new Error('Koha duhet të jetë nga 1 minutë deri në 14 ditë përpara.');
  plan.at = ms; saveToolPlan(inst, what, plan);
  addHistory(inst, { title: 'Instalimi i ' + TOOL_NAMES[what] + ' u caktua', ok: true, detail: new Date(ms).toLocaleString('sq-AL') });
  return { ok: true, at: ms };
}
async function toolScheduleTick() {
  for (const inst of instances()) {
    if (!inst.root || !inst.data) continue;
    // Automatic download (on unless the owner switched it off): a new version is fetched into the staging folder, once per 6 hours per program.
    if ((readSettings(inst).toolAuto || {}).download !== false) {
      const busy = jobs.get(inst.id);
      if (!busy || busy.state !== 'running') {
        try {
          const info = await toolsInfo();
          for (const what of ['node', 'cloudflared']) {
            const key = inst.id + ':' + what;
            if (!info[what].update || plannedOf(inst, what) || Date.now() - (toolAutoLast.get(key) || 0) < 6 * 3600000) continue;
            toolAutoLast.set(key, Date.now());
            toolDownload(inst, what, 'auto');
            break;
          }
        } catch { /* the next minute */ }
      }
    }
    const plans = toolPlans(inst);
    for (const what of Object.keys(plans)) {
      const p = plans[what];
      if (!p || !p.at || p.at > Date.now()) continue;
      if (Date.now() - p.at > 6 * 3600000) {
        delete p.at; saveToolPlan(inst, what, p);
        addHistory(inst, { title: 'Instalimi i ' + TOOL_NAMES[what] + ' u anulua', ok: false, detail: 'Dashboard-i nuk punonte në kohën e caktuar.' });
        notify(inst, 'Përditësimi i ' + TOOL_NAMES[what] + ' u anulua', 'Dashboard-i nuk punonte në kohën e caktuar; cakto një kohë të re.', 'warn');
        continue;
      }
      const job = jobs.get(inst.id);
      if (job && job.state === 'running') continue; // another action is running: tried again in a minute
      try { toolInstall(inst, what, 'auto'); const cur = toolPlans(inst)[what]; if (cur) { delete cur.at; saveToolPlan(inst, what, cur); } } catch { /* busy: next minute */ }
      break;
    }
  }
}
setInterval(() => { toolScheduleTick().catch(() => {}); }, 60000).unref();

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
    // Started through WMI (like the application's launcher): the process is not a child of the dashboard, so it is not in the job of the dashboard's
    // scheduled task and survives its restarts and updates (a child was ended with the task: the temporary address vanished after an update).
    const cmd = '"' + exe + '" tunnel --no-autoupdate --url http://localhost:' + (env.PORT || 3000) + ' --logfile "' + log + '"';
    const pidOut = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `$s = New-CimInstance -ClassName Win32_ProcessStartup -Namespace root/cimv2 -ClientOnly -Property @{ ShowWindow = [uint16]0 }; $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${q(cmd)}; CurrentDirectory = ${q(path.dirname(exe))}; ProcessStartupInformation = [CimInstance]$s }; if ($r.ReturnValue -eq 0) { $r.ProcessId } else { throw ('WMI ' + $r.ReturnValue) }`]);
    const proc = { pid: Number(String(pidOut).trim().split(/\s+/).pop()) };
    if (!proc.pid) throw new Error('cloudflared nuk u nis.');
    let url = '';
    for (let i = 0; i < 40 && !url; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try { const m = /https:[/][/][a-z0-9-]+[.]trycloudflare[.]com/.exec(fs.readFileSync(log, 'utf8')); if (m) url = m[0]; } catch { /* not written yet */ }
    }
    if (!url) { try { process.kill(proc.pid); } catch { /* gone */ } throw new Error('Adresa e përkohshme nuk u krijua (kontrollo internetin).'); }
    fs.writeFileSync(quickFile(inst), JSON.stringify({ pid: proc.pid, url }));
    { const cur = readSettings(inst); cur.quickLast = { url, at: new Date().toISOString() }; cur.domainsHidden = (cur.domainsHidden || []).filter((x) => x !== url); settingsWrite(inst, cur); }
    setQuickWanted(inst, true);
    return { url };
  } finally { quickStarting = false; }
}
function stopQuick(inst) {
  try { const j = JSON.parse(fs.readFileSync(quickFile(inst), 'utf8')); process.kill(j.pid); } catch { /* not running */ }
  try { fs.rmSync(quickFile(inst), { force: true }); } catch { /* gone */ }
  { const cur = readSettings(inst); delete cur.quickLast; settingsWrite(inst, cur); }
  setQuickWanted(inst, false);
  return { ok: true };
}
const quickBackoff = new Map(); // inst.id -> { next, fails }
setInterval(() => {
  try {
    for (const inst of instances()) {
      if (!(inst.root && readSettings(inst).quickWanted && !quickState(inst) && !quickStarting)) continue;
      const wait = quickBackoff.get(inst.id) || { next: 0, fails: 0 };
      if (Date.now() < wait.next) continue;
      const before = (readSettings(inst).quickLast || {}).url || '';
      // The temporary tunnel is gone (the PC restarted, or the process ended): a new one is made. Its address is NEW (Cloudflare gives a random one each time), so the phone is told which.
      startQuick(inst).then((r) => { quickBackoff.delete(inst.id); if (r && r.url && r.url !== before) { notify(inst, 'Adresa e përkohshme ndryshoi', 'Adresa e re: ' + r.url, 'info'); addHistory(inst, { title: 'Adresa e përkohshme ndryshoi', ok: true, detail: r.url }); } }).catch(() => { const f = (quickBackoff.get(inst.id) || { fails: 0 }).fails + 1; quickBackoff.set(inst.id, { fails: f, next: Date.now() + Math.min(60000 * 2 ** (f - 1), 900000) }); });
    }
  } catch { /* next round */ }
}, 20000).unref();

// The dashboard updates itself from its own PUBLIC GitHub repo (owner, 2026-10-22): one repo for every installation, no token needed. The files
// of its main branch are compared with the local ones by their git blob hash. A new version is downloaded and applied by itself (every 10
// minutes, and from the "Përditëso dashboard-in" button); the old files are kept in manager/.previous/, server.mjs is written last (its change
// makes the dashboard start itself again) and a guard process puts the old files back when the new dashboard does not answer within 25 s.
// Only an installed dashboard updates; only files that already exist here are replaced.
const DASH_REPO = process.env.DASHBOARD_REPO || 'rogest-network/HRSystem-Dashboard';
const gitBlobSha = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex');
async function ghJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hrsystem-dashboard' }, signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (!res.ok) throw new Error('GitHub ' + res.status);
  return res.json();
}
const dashSafe = (rel) => { const full = path.resolve(HERE, rel); return full.startsWith(HERE + path.sep) && !rel.startsWith('.previous') ? full : null; };
// The repo holds only the dashboard (owner, 2026-10-22): the installer scripts (setup, update, uninstall, SQL import) live in the Setup folder / zip and are
// never in this repo, so the dashboard never replaces them. (Until then the repo also carried root/<script>.ps1 mirrors of three of them.)
const localPathOf = (rel) => dashSafe(rel);
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
    return { ok: true, files: files.length, server: !!server };
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
  try {
    const s = await dashboardState(true);
    if (s && s.files > 0) {
      const r = await updateDashboard();
      if (r && r.files) for (const inst of instances()) if (inst.local) {
        // A new server.mjs restarts the dashboard, and the new process announces its version with the notes (announceDashboardVersion): no second message here.
        if (!r.server) { notify(inst, 'Dashboard-i u përditësua', 'U instaluan ' + r.files + ' skedarë të rinj të dashboard-it.', 'ok'); addHistory(inst, { title: 'Dashboard-i u përditësua', ok: true, detail: r.files + ' skedarë' }); }
      }
    }
  } catch { /* next round */ }
}
function INSTALLED_EARLY() { return fs.existsSync(path.join(path.dirname(HERE), 'current.txt')); }
if (INSTALLED_EARLY()) { setTimeout(autoUpdateDashboard, 120000).unref(); setInterval(autoUpdateDashboard, 600000).unref(); }
// After a self-update the NEW process tells (once per installation) which version of the dashboard it is and what is new since the one this PC had before.
// An installation that never recorded a version counts as 1.0.0 (a brand-new one with no history stays silent).
function announceDashboardVersion() {
  for (const inst of instances()) {
    if (!inst.local) continue;
    const cur = readSettings(inst);
    if (cur.dashSeen === DASH_VERSION) continue;
    const fresh = cur.dashSeen === undefined && !(cur.history && cur.history.length);
    const from = cur.dashSeen || '1.0.0';
    if (!fresh) {
      const news = DASH_NOTES.filter((n) => cmp(n.version, from) > 0).slice(0, 5);
      notify(inst, 'Dashboard-i u përditësua në v' + DASH_VERSION, (news.length ? 'Çfarë ka të re:' + NOTE_NL + notesText(dashNotesAsReleaseNotes(news)) : 'Versioni ' + DASH_VERSION), 'ok');
      addHistory(inst, { title: 'Dashboard-i u përditësua', ok: true, detail: 'v' + from + ' → v' + DASH_VERSION });
    }
    const latestSettings = readSettings(inst); latestSettings.dashSeen = DASH_VERSION; settingsWrite(inst, latestSettings);
  }
}
if (INSTALLED_EARLY()) setTimeout(() => { try { announceDashboardVersion(); } catch { /* next start */ } }, 20000).unref();

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
// backups of the folder are kept (since 1.7.5 manual ones and the updater's count too). The result of the last run is shown in Veprime.
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
// Owner, 2026-10-25: "keep the last 7, all of them": after the night job ONLY the newest `keep` backups of the folder stay, whoever made them
// (the night job, the updater or a button). `names` is no longer needed to tell them apart; the argument stays so the callers do not change.
function rememberAndPrune(inst, names, keep) {
  const mine = readSettings(inst); mine.autoBackupFiles = [...new Set([...(mine.autoBackupFiles || []), ...names])].slice(-400);
  try { fs.writeFileSync(settingsFile(inst), JSON.stringify(mine, null, 2)); } catch { /* read-only folder */ }
  for (const old of listBackups(inst).slice(keep)) { try { fs.unlinkSync(path.join(backupDir(inst), old.name)); } catch { /* in use */ } }
}
const skipNoted = new Map();
async function autoBackupTick() {
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  for (const inst of instances()) {
    if (!inst.root || !inst.data) continue;
    const auto = autoBackupOf(inst);
    // two independent switches (backup, update of the program), one shared hour: either, both or none
    // Once a day PER HOUR: when the owner moves the hour (e.g. 01:00 -> 19:00) the job runs again at the new hour even if it already ran today at the old one
    // (owner, 2026-10-23: he moved it to 19:00 to get an update and nothing happened because today's run had been done). An old record without an hour counts as the same hour.
    const doneToday = auto.last && auto.last.date === today && (auto.last.hour === undefined || auto.last.hour === auto.hour);
    if (auto.on || auto.updateToo) {
      // The reason is written to the history once, so "why did it not run at this hour?" can be answered from the dashboard.
      const noted = today + '|' + auto.hour;
      if (now.getHours() === auto.hour && doneToday && skipNoted.get(inst.id) !== noted) { skipNoted.set(inst.id, noted); addHistory(inst, { title: 'Puna automatike nuk u nis', ok: false, detail: 'sot u krye tashmë në orën e njëjtë (' + auto.last.date + ')' }); }
    }
    if ((!auto.on && !auto.updateToo) || now.getHours() !== auto.hour || doneToday) continue;
    const running = jobs.get(inst.id);
    if (running && running.state === 'running') continue;
    const record = { date: today, hour: auto.hour, at: new Date().toISOString() };
    const kind = auto.updateToo ? updateKindPinned(inst, installed(inst), await latestCached(inst).catch(() => null)) : null;
    if (kind) {
      // the update makes the backup (its first step): one backup, then the new version
      saveAutoResult(inst, record, 'update_started');
      try {
        const job = runUpdate(inst, 'auto');
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
// The release notes as a short text for a phone message: "Versioni X:" and its "- " lines as bullets, cut at 600 characters.
const NOTE_NL = String.fromCharCode(10);
// The dashboard's own version and what each version brought (newest first, plain Albanian). Raise DASH_VERSION and add an entry with EVERY published change:
// the page shows it ("Çfarë ka të re"), and after a self-update the phone gets the notes of the versions that are new on this PC (announceDashboardVersion).
const DASH_VERSION = '1.8.1';
const DASH_NOTES = [
  { version: '1.8.1', date: '2026-10-26', notes: [
    'Udhëzuesi "Si ta përdorësh" u përditësua: Kryesore (veprime të shpejta, veprimet e fundit), Vendndodhja, Gabimet, Çfarë ka të re, zona e rrezikut dhe Eksporto SQL.',
    'Programet e sistemit shpjegohen me dy hapat: Shkarko, pastaj Instalo tani ose Cakto kohën; plus shkarkimi dhe instalimi automatik.',
    'Te njoftimet shtohen raportet e gabimeve, dhe te problemet e zakonshme: raportimi kërkon programin 1.0.7 ose më të ri.',
  ] },
  { version: '1.8.0', date: '2026-10-25', notes: [
    'Faqe e re "Gabimet e raportuara": raportet që punonjësit dërgojnë nga aplikacioni (Profili → Rreth Aplikacionit → Raporto një gabim) me emrin, rolin, pikën, telefonin dhe versionin.',
    'Katër skeda: Të raportuara, Në përpunim, Të zgjidhura dhe Roadmap; çdo raport kalon nga një skedë te tjetra me një buton.',
    'Njoftim në telefon kur vjen raport i ri (ndahet me çelës te Njoftimet) dhe numër i kuq te menuja.',
  ] },
  { version: '1.7.5', date: '2026-10-25', notes: [
    'Backup-et: pas punës së natës mbeten vetëm të fundit sa ke zgjedhur (p.sh. 7), pa dallim kush i ka bërë: nata, përditësimi ose butoni.',
  ] },
  { version: '1.7.4', date: '2026-10-24', notes: [
    'Llamba e kuqe nuk ndizet më për një përgjigje të vetme të ngadaltë: aplikacioni dhe adresat pyeten edhe një herë para se të shfaqen si të rënë.',
  ] },
  { version: '1.7.3', date: '2026-10-24', notes: [
    'Përditësimi i programit nuk dështon më për shkak të paralajmërimeve të npm-it të ri (pas përditësimit të Node.js).',
  ] },
  { version: '1.7.2', date: '2026-10-24', notes: [
    'Menuja tregon poshtë LIVE versionin e dashboard-it.',
  ] },
  { version: '1.7.1', date: '2026-10-24', notes: [
    'Node.js: pas instalimit aplikacioni ndizet vetë dhe dashboard-i rindizet vetë nëse mbyllet.',
  ] },
  { version: '1.7.0', date: '2026-10-24', notes: [
    'Programet e sistemit: shkarkimi dhe instalimi janë dy hapa; shkarkon tani dhe e instalon kur të duash.',
    'Mund ta caktosh kohën e instalimit (nga 02:00 si parazgjedhje, por e zgjedh ti), ose të instalosh menjëherë.',
    'Automatik: shkarkim i vetvetishëm i versioneve të reja (i ndezur) dhe instalim i vetvetishëm në orën që zgjedh ti (i fikur).',
    'Skedarët kontrollohen me SHA-256 para instalimit; Setup-i instalon Node.js të fundit të provuar me sistemin.',
  ] },
  { version: '1.6.0', date: '2026-10-24', notes: [
    'Veprime: karta e re "Programet e sistemit" tregon versionin e Node.js dhe të cloudflared (tunelit) dhe të rejat nga interneti.',
    'Mund t\'i përditësosh me një buton (pyet dy herë; hapat shihen te Log-u). Node.js ndryshon vetëm brenda të njëjtit version të madh dhe kontrollohet me SHA-256; cloudflared përditësohet me winget.',
    'Rreshtat e Log-ut përkthehen sipas gjuhës së zgjedhur.',
  ] },
  { version: '1.5.1', date: '2026-10-24', notes: [
    'Dashboard-i lexon përditësimet nga emri i ri i GitHub (rogest-network); emri i vjetër vazhdon të punojë.',
  ] },
  { version: '1.5.0', date: '2026-10-24', notes: [
    'Pamje e re profesionale: font Inter, menu e errët, ngjyra vjollcë, karta dhe butona të njëjtë në çdo faqe.',
    'Menuja anësore mbyllet me shigjetën lart (vetëm ikona); mbahet mend zgjedhja.',
    'Çfarë ka të re: vetëm versioni i fundit është i hapur, të vjetrit hapen me një klik.',
    'Kopje jashtë PC-së: karta e re e folderit me rrugën e plotë, gjendjen dhe veprimet Ndrysho, Shkëput, Rilidh, Hiq.',
    'Veprime: veprimet e përditshme janë ndarë nga rikthimi dhe zona e rrezikut.',
    'Log-u dhe Gabimet: rreshtat e gabimeve dhe kujdesit kanë ngjyrë dhe fjalë (GABIM, KUJDES).',
  ] },
  { version: '1.4.2', date: '2026-10-24', notes: [
    'Cilësimet janë tani një buton i gjerë lart, poshtë logos.',
    'Çinstalo HRSystem u zhvendos te fundi i faqes Veprime (Zona e rrezikut) dhe pyet dy herë.',
  ] },
  { version: '1.4.1', date: '2026-10-24', notes: [
    'Përditësimi tregon tani si u krye: automatikisht (nata) ose manualisht (me buton), te Historiku, Veprimet e fundit, Log-u dhe njoftimi në telefon.',
  ] },
  { version: '1.4.0', date: '2026-10-24', notes: [
    'Njoftimet: zgjedh çfarë të vijë në telefon (aplikacioni, adresat, backup-et, disku, përditësimet, raporti i ditës); teksti u shkurtua.',
    'Eksporto SQL: shkarkon një dump të databazës me një klikim (te Veprime › Databaza).',
    'Cilësimet: kartë e re "Kontakto Administratorin" me WhatsApp dhe email.',
    'Butonat pa "tani" (Backup, Kopjo, Ndrysho, Dërgo raportin) dhe tekste më të shkurtra te Veprime.',
  ] },
  { version: '1.3.3', date: '2026-10-23', notes: [
    'Kryesore: tekstet "e fundit", "në 24 orë" dhe "dashboard-i dhe programi" tani përkthehen edhe në anglisht e serbisht.',
  ] },
  { version: '1.3.2', date: '2026-10-23', notes: [
    'Kryesore: "Veprime të shpejta" janë tani më lart, para kartave.',
  ] },
  { version: '1.3.1', date: '2026-10-23', notes: [
    'Kryesore: adresat nuk dyfishohen më. Karta "Lidhja" ka adresat dhe veprimet (hiq domenin, ndrysho adresën ose tunelin), ndërsa poshtë shfaqen "Veprimet e fundit".',
  ] },
  { version: '1.3.0', date: '2026-10-23', notes: [
    'Logoja e re e HRSystem në vend të katrorit "HR": te menuja, ekrani i ngarkimit, faqja e hyrjes dhe ikona e faqes.',
    'Kryesore ka opsione të reja: veprime të shpejta (backup, përditëso, log-u, historiku, gabimet, kopjo adresën, çfarë ka të re).',
    'Kartat Databaza dhe Lidhja janë më të plota: emri, serveri, madhësia, backup i fundit; adresat, domeni dhe tuneli me gjendje.',
  ] },
  { version: '1.2.0', date: '2026-10-23', notes: [
    'Dizajn i ri: shkronja JetBrains Mono, kartat kanë ikona (CPU, databazë, lidhje, disk, version, backup) dhe faqja "Pasqyra" quhet "Kryesore".',
    'Kërkim me Ctrl + K: faqet, instalimet dhe veprimet e shpejta (hap aplikacionin, backup, përditëso, tema).',
    'Ngjyra të njëjta për statuset kudo: online / sukses, offline / gabim, paralajmërim, duke u lidhur, joaktiv, në pritje, mirëmbajtje.',
  ] },
  { version: '1.1.1', date: '2026-10-23', notes: ['Faqe e re në menu: "Çfarë ka të re" (dashboard-i dhe programi).'] },
  { version: '1.1.0', date: '2026-10-23', notes: [
    'Dashboard-i ka numër versioni dhe pas çdo përditësimi të vetes tregon çfarë ka të re, në faqe dhe në njoftimin në telefon.',
    'Shënimet e versionit të programit (çfarë ka të re) shfaqen te Pasqyra para përditësimit dhe në njoftimin "Ka version të ri".',
    'Njoftimi "Përditësimi u krye" i përsërit çfarë ka të re.',
    'Puna automatike e natës rinis kur ndërron orën (p.sh. nga 01:00 në 19:00), edhe nëse sot ka punuar tashmë; historiku tregon pse nuk u nis.',
  ] },
  { version: '1.0.0', date: '2026-10-21', notes: ['Versioni i parë me numër: pasqyra, backup-et, përditësimet, njoftimet.'] },
];
const dashNotesAsReleaseNotes = (list) => list.map((n) => ({ version: n.version, body: n.notes.map((l) => '- ' + l).join(NOTE_NL) }));
function notesText(notes) {
  const NL = NOTE_NL;
  const out = [];
  for (const n of notes || []) {
    const lines = String(n.body || '').split(NL).map((l) => l.trim()).filter(Boolean)
      .map((l) => l.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '• ').replace(/[*`]/g, ''));
    out.push((notes.length > 1 ? 'Versioni ' + n.version + ':' + NL : '') + lines.join(NL));
  }
  const text = out.join(NL).trim();
  return text.length > 600 ? text.slice(0, 597).trimEnd() + '...' : text;
}
function jobDone(inst, job) {
  const last = job.lines[job.lines.length - 1] || '';
  const ok = job.state === 'ok';
  addHistory(inst, { title: job.title, ok, detail: last.slice(0, 160), by: job.by });
  if (!ok) { notify(inst, 'Veprimi dështoi', job.title + (last ? ': ' + last.slice(0, 140) : ''), 'error'); logError('Veprimi: ' + job.title, new Error(last || 'dështoi')); }
  else if (/^Përditësimi i (Node\.js|Cloudflare Tunnel)$/.test(job.title)) {
    notify(inst, job.title + ' u krye', (job.by === 'auto' ? 'U krye automatikisht në kohën e caktuar.' : 'U krye manualisht (nga dashboard-i).') + NOTE_NL + last, 'ok');
  } else if (job.title === 'Perditesim' || job.title === 'Rikthim i versionit') {
    // After an update the notes of that version are repeated (saved when the new version was announced).
    const now = installed(inst) || {}, saved = (readSettings(inst).lastNotes || {});
    const extra = job.title === 'Perditesim' && saved.version === now.version && saved.text ? NOTE_NL + NOTE_NL + 'Çfarë ka të re:' + NOTE_NL + saved.text : '';
    const how = job.title === 'Perditesim' ? (job.by === 'auto' ? 'U krye automatikisht (nata).' : 'U krye manualisht (nga dashboard-i).') + NOTE_NL : '';
    notify(inst, job.title === 'Perditesim' ? 'Përditësimi u krye' : 'Rikthimi i versionit u krye', how + 'Versioni aktual: ' + (now.name || '?') + extra, 'ok');
  }
}

// ---- notifications: ntfy.sh (a topic name the owner subscribes to in the free ntfy phone app) or any webhook URL; opt-in, off until set
// What the owner can switch on or off on the phone: one switch per kind of message (all on by default). The daily report has its own switch.
const NOTE_CATS = ['app', 'address', 'backup', 'disk', 'update', 'bugs'];
function noteCategory(title) {
  if (/^Raport gabimi/.test(title)) return 'bugs';
  if (/^(Aplikacioni|Nisja me Windows)/.test(title)) return 'app';
  if (/^Adresa/.test(title)) return 'address';
  if (/^(Backup|Kopja)/.test(title)) return 'backup';
  if (/^Pak hapësirë/.test(title)) return 'disk';
  return 'update';
}
function notifyOf(inst) { const n = readSettings(inst).notify || {}; return { on: !!n.on, target: String(n.target || ''), daily: n.daily !== false, hour: hourOf(n.hour), events: Object.fromEntries(NOTE_CATS.map((c) => [c, (n.events || {})[c] !== false])) }; }
function hourOf(v) { const h = Number(v); return v !== undefined && v !== null && v !== '' && Number.isInteger(h) && h >= 0 && h <= 23 ? h : DAILY_HOUR; }
// Every message has a LEVEL: critical (the application is down), error (something failed), warn (attention), ok (all good / done), info (what was done by hand). The level sets
// the priority and the icon on the phone; the title is "<company> · <what happened>" and the body ends with the time.
const NOTE_LEVELS = { critical: { priority: 5, tags: ['rotating_light'] }, error: { priority: 4, tags: ['x'] }, warn: { priority: 4, tags: ['warning'] }, ok: { priority: 3, tags: ['white_check_mark'] }, info: { priority: 2, tags: ['information_source'] } };
function composeNote(inst, title, message, level) {
  const L = NOTE_LEVELS[level] || NOTE_LEVELS.info, d = new Date(), p = (n) => String(n).padStart(2, '0');
  return { title: (inst.name ? inst.name + ' · ' : '') + title, message: String(message || '').trim() + '\n— ' + p(d.getHours()) + ':' + p(d.getMinutes()), level, ...L };
}
async function sendNotify(target, note) {
  if (!target) throw new Error('Mungon adresa e njoftimit.');
  const isUrl = /^https?:\/\//i.test(target);
  const r = await fetch(isUrl ? target : 'https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isUrl ? { title: note.title, message: note.message, level: note.level, text: note.title + ': ' + note.message } : { topic: target, title: note.title, message: note.message, priority: note.priority, tags: note.tags }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Shërbimi i njoftimit u përgjigj ' + r.status + '.');
}
function notify(inst, title, message, level = 'info', cat = noteCategory(title)) {
  const n = notifyOf(inst);
  if (!n.on || !n.target) return;
  if (cat !== 'daily' && n.events[cat] === false) return;
  sendNotify(n.target, composeNote(inst, title, message, level)).catch(() => { /* a failed notification never breaks anything */ });
}
function setNotify(inst, on, target, daily, hour, events) {
  const cur = readSettings(inst);
  const kept = { ...((cur.notify || {}).events || {}) };
  if (events && typeof events === 'object') for (const c of NOTE_CATS) if (typeof events[c] === 'boolean') kept[c] = events[c];
  const t = target === undefined ? String((cur.notify || {}).target || '') : String(target).trim();
  if (t && !/^[A-Za-z0-9_-]{3,64}$/.test(t) && !/^https?:\/\/\S+$/i.test(t)) throw new Error('Adresa: një emër teme (shkronja, shifra, - _ ; min. 3) ose një URL https.');
  cur.notify = { events: kept, on: (on === undefined ? !!(cur.notify || {}).on : !!on) && !!t, target: t, daily: daily === undefined ? (cur.notify || {}).daily !== false : !!daily, hour: hour === undefined ? (cur.notify || {}).hour : (Number.isInteger(Number(hour)) && Number(hour) >= 0 && Number(hour) <= 23 ? Number(hour) : (() => { throw new Error('Ora duhet të jetë 0-23.'); })()) };
  settingsWrite(inst, cur);
  return notifyOf(inst);
}
// Watcher: the app is down for 1 minute -> a message; it is back -> a message. Not while an update / rollback runs. Low disk: once a day.
// A new version of the program on GitHub: ONE message per version (owner, 2026-10-22), not one every 30 s. The end of the update is announced by jobDone().
async function updateAvailableCheck(inst) {
  const l = await latestCached(inst).catch(() => null), i = installed(inst);
  if (!l || l.error || !updateKindPinned(inst, i, l)) return;
  const key = l.version + '|' + (l.build || ''), cur = readSettings(inst);
  if (cur.lastUpdateNotified === key) return;
  const text = notesText(l.notes);
  cur.lastUpdateNotified = key; cur.lastNotes = { version: l.version, text }; settingsWrite(inst, cur);
  const a = autoBackupOf(inst);
  notify(inst, 'Ka version të ri', 'Versioni ' + l.version + ' është gati (instaluar: ' + ((i && i.name) || '?') + ').' + (a.updateToo ? ' Do të instalohet vetë në orën ' + String(a.hour).padStart(2, '0') + ':00.' : ' Përditësoje nga dashboard-i.') + (text ? NOTE_NL + NOTE_NL + 'Çfarë ka të re:' + NOTE_NL + text : ''), 'info');
  addHistory(inst, { title: 'Ka version të ri', ok: true, detail: l.version });
}
// ---- bug reports ("Raporto një gabim" in the program, migration 0015). The dashboard only READS the table (mysql command line, one JSON object per row,
// local database only); the owner's own decisions (in progress / solved / roadmap) are kept in dashboard-settings.json under `bugs.states`, never written
// to the application's database. No entry for a report = "reported". New reports are announced on the phone once (`bugs.notifiedAt`).
const BUG_STATES = ['progress', 'solved', 'roadmap'];
const bugNew = new Map(); // inst.id -> how many reports are still "reported" (for the menu badge)
const bugChecked = new Map(); // inst.id -> time of the last look at the table
async function readBugReports(inst) {
  const cfg = readEnv(path.join(inst.root, '.env'));
  const sql = "SELECT JSON_OBJECT('id',`id`,'reporter',`reporter_name`,'role',`reporter_role`,'store',`location_name`,'page',`page`,'message',`message`,'device',`device`,'version',`app_version`,'created',DATE_FORMAT(`created`,'%Y-%m-%dT%H:%i:%s.%fZ')) FROM `bug_reports` ORDER BY `created` DESC LIMIT 500";
  let out;
  try { out = await mysqlQuery(cfg, sql, cfg.DB_NAME, true); } catch (e) { if (/doesn't exist/i.test(String(e.message))) return { items: [], missing: true }; throw e; }
  const items = [];
  // Batch mode doubles every backslash of the JSON text; two backslashes become one again.
  for (const line of String(out || '').split(/\r?\n/)) { if (!line.trim()) continue; try { items.push(JSON.parse(line.replace(/\\\\/g, '\\'))); } catch { /* a damaged line is skipped */ } }
  return { items, missing: false };
}
function bugStatesOf(inst) { const b = readSettings(inst).bugs; return b && b.states && typeof b.states === 'object' ? b.states : {}; }
async function bugsOf(inst) {
  const { items, missing } = await readBugReports(inst), states = bugStatesOf(inst);
  const list = items.map((x) => ({ ...x, status: BUG_STATES.includes((states[x.id] || {}).status) ? states[x.id].status : 'new', changed: (states[x.id] || {}).at || null }));
  const counts = { new: 0, progress: 0, solved: 0, roadmap: 0 };
  for (const x of list) counts[x.status] += 1;
  bugNew.set(inst.id, counts.new);
  return { items: list, counts, missing };
}
function setBugStatus(inst, report, status) {
  if (!/^[0-9a-f]{24}$/.test(String(report))) throw new Error('Raporti nuk është i vlefshëm.');
  if (status !== 'new' && !BUG_STATES.includes(status)) throw new Error('Gjendja nuk është e vlefshme.');
  const cur = readSettings(inst), bugs = cur.bugs && typeof cur.bugs === 'object' ? cur.bugs : {};
  const states = bugs.states && typeof bugs.states === 'object' ? bugs.states : {};
  if (status === 'new') delete states[report]; else states[report] = { status, at: new Date().toISOString() };
  if (Object.keys(states).length > 5000) throw new Error('Shumë raporte të shënuara.');
  cur.bugs = { ...bugs, states };
  settingsWrite(inst, cur);
}
// Every 5 minutes: refresh the badge and send ONE message for the reports that arrived since the last look (the first look only remembers the newest one).
async function bugsCheck(inst) {
  if (Date.now() - (bugChecked.get(inst.id) || 0) < 300000) return;
  bugChecked.set(inst.id, Date.now());
  const { items, missing } = await bugsOf(inst);
  if (missing) return;
  const cur = readSettings(inst), bugs = cur.bugs && typeof cur.bugs === 'object' ? cur.bugs : {};
  const newest = items.length ? items[0].created : null;
  if (bugs.notifiedAt === undefined) { cur.bugs = { ...bugs, notifiedAt: newest || new Date().toISOString() }; settingsWrite(inst, cur); return; }
  const fresh = items.filter((x) => x.created > bugs.notifiedAt).reverse();
  if (!fresh.length) return;
  cur.bugs = { ...bugs, notifiedAt: newest }; settingsWrite(inst, cur);
  const first = fresh[0];
  notify(inst, 'Raport gabimi nga ' + (first.reporter || '?'), (first.store ? first.store + ': ' : '') + String(first.message || '').replace(/\s+/g, ' ').slice(0, 160) + (fresh.length > 1 ? NOTE_NL + '(+' + (fresh.length - 1) + ' raporte të tjera)' : ''), 'info');
  addHistory(inst, { title: 'Raport i ri gabimi', ok: true, detail: (first.reporter || '?') + (fresh.length > 1 ? ' +' + (fresh.length - 1) : '') });
}
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
      if (ok) { const st = readSettings(inst); if (st.manualStop && Date.now() - st.manualStop > 20000) { delete st.manualStop; settingsWrite(inst, st); } }
      if (ok && w.told && !w.selfStarted) { notify(inst, 'Aplikacioni u kthye', 'Punon përsëri.', 'ok'); addHistory(inst, { title: 'Aplikacioni u kthye online', ok: true, detail: '' }); }
      w.down = 0; w.told = false; w.selfStarted = false;
    } else {
      if (!w.down) w.down = Date.now();
      // Self-heal (owner, 2026-10-22): when it fell by itself (not stopped with the Stop button) and "Nisja me Windows" for the application is ON, it is started again
      // after a minute (at most once every 10 minutes). When the owner stopped it, or the switch is off, nothing is started.
      if (Date.now() - w.down >= 60000 && Date.now() - (w.lastStart || 0) > 600000 && !readSettings(inst).manualStop) {
        try {
          const app = (await autostartState(inst).catch(() => [])).find((x) => x.key === 'app');
          if (app && app.on) {
            w.lastStart = Date.now(); w.selfStarted = true;
            systemAction.quiet = true; try { await systemAction(inst, 'start'); } finally { systemAction.quiet = false; }
            addHistory(inst, { title: 'Aplikacioni u ndez vetë (kishte rënë)', ok: true, detail: '' });
            notify(inst, 'Aplikacioni u ndez vetë', 'Ishte mbyllur vetë; dashboard-i e ndezi përsëri (ndezja automatike është e ndezur).', 'warn');
          }
        } catch { /* tried; the next attempt is in 10 minutes */ }
      }
      if (!w.told && Date.now() - w.down >= 60000 && !readSettings(inst).manualStop) { w.told = true; notify(inst, 'Aplikacioni u mbyll vetë', 'U mbyll pa e ndalur ti dhe nuk përgjigjet prej 1 minute.', 'critical'); addHistory(inst, { title: 'Aplikacioni nuk përgjigjet', ok: false, detail: 'prej ' + new Date(w.down).toLocaleTimeString('sq-AL', { hour12: false }) }); }
    }
    try { staleBackupCheck(inst); } catch { /* next time */ }
    try { await addressCheck(inst); } catch { /* next time */ }
    try { await updateAvailableCheck(inst); } catch { /* next time */ }
    try { await dailyReportCheck(inst); } catch { /* next time */ }
    try { await bugsCheck(inst); } catch { /* next time */ }
    const d = diskOf(inst.data || inst.root);
    if (d && d.total && d.free / d.total < 0.1) {
      const cur = readSettings(inst), day = new Date().toISOString().slice(0, 10);
      if (cur.lastDiskAlert !== day) { cur.lastDiskAlert = day; settingsWrite(inst, cur); notify(inst, 'Pak hapësirë në disk', 'Mbeten ' + (d.free / 1073741824).toFixed(1) + ' GB (' + Math.round((100 * d.free) / d.total) + '%).', 'warn'); addHistory(inst, { title: 'Pak hapësirë në disk', ok: false, detail: (d.free / 1073741824).toFixed(1) + ' GB të lira' }); }
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
  if (!record.ok && (!before || before.ok)) { notify(inst, 'Kopja jashtë PC-së dështoi', record.error, 'error'); addHistory(inst, { title: 'Kopja jashtë PC-së', ok: false, detail: record.error }); }
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
  let value = { appSince: null, cpu: 0, ram: 0, appRam: 0, dbRam: 0, io: null, readBps: 0, writeBps: 0, todayR: 0, todayW: 0, totalR: 0, totalW: 0 };
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
      `foreach ($x in @($appPid, $dbPid)) { if ($x -gt 0) { $q = Get-CimInstance Win32_Process -Filter "ProcessId=$x"; if ($q) { 'io|' + $x + '|' + $q.ReadTransferCount + '|' + $q.WriteTransferCount } } }; ` +
      `foreach ($pp in (Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -gt 0 -and $_.IDProcess -in @($appPid, $dbPid) })) { ($(if ($pp.IDProcess -eq $appPid) { 'app' } else { 'db' })) + '|' + $pp.PercentProcessorTime + '|' + $pp.WorkingSetPrivate }; "cores|$cores"`]);
    let cores = 1, cpu = 0, ioR = 0, ioW = 0;
    const procsNow = {};
    for (const l of out.split(/\r?\n/)) {
      const p = l.trim().split('|');
      if (p[0] === 'since') value.appSince = p[1];
      else if (p[0] === 'cores') cores = Number(p[1]) || 1;
      else if (p[0] === 'io') { const r = Number(p[2]) || 0, w = Number(p[3]) || 0; procsNow[p[1]] = { r, w }; ioR += r; ioW += w; }
      else if (p[0] === 'app') { cpu += Number(p[1]) || 0; value.appRam = Number(p[2]) || 0; }
      else if (p[0] === 'db') { cpu += Number(p[1]) || 0; value.dbRam = Number(p[2]) || 0; }
    }
    value.cpu = Math.min(100, Math.round((cpu / cores) * 10) / 10); value.ram = value.appRam + value.dbRam;
    // Data moved by the HR processes (reads and writes: the network, the database and the disk of the application and its MySQL), speed since the last look and the total of today.
    const now = Date.now(), prev = c && c.value && c.value.io;
    value.io = { t: now, procs: procsNow }; value.totalR = ioR; value.totalW = ioW;
    if (prev && prev.procs && now > prev.t) {
      // counted per process: a process that restarted (a new pid) counts from its own start, never the whole lifetime of another one
      let dr = 0, dw = 0;
      for (const [pid, c] of Object.entries(procsNow)) {
        const o = prev.procs[pid];
        if (o) { dr += c.r >= o.r ? c.r - o.r : c.r; dw += c.w >= o.w ? c.w - o.w : c.w; }
        else { dr += c.r; dw += c.w; }
      }
      const secs = Math.max(1, (now - prev.t) / 1000);
      value.readBps = dr / secs; value.writeBps = dw / secs;
      if (dr + dw > 0) {
        const cur = readSettings(inst), day = new Date().toISOString().slice(0, 10);
        const d = cur.ioDay && cur.ioDay.date === day && cur.ioDay.v === 2 ? cur.ioDay : { date: day, v: 2, r: 0, w: 0 }; // v2: per-process counting (the first version counted a restarted process's whole lifetime)
        d.r = (d.r || 0) + dr; d.w = (d.w || 0) + dw; cur.ioDay = d; settingsWrite(inst, cur);
      }
    }
    const dd = readSettings(inst).ioDay, same = dd && dd.v === 2 && dd.date === new Date().toISOString().slice(0, 10); value.todayR = same ? dd.r || 0 : 0; value.todayW = same ? dd.w || 0 : 0;
  } catch { /* leave zeros */ }
  procSeen.set(inst.id, { at: Date.now(), value });
  return value;
}
async function systemOf(inst) {
  const hr = inst.root ? await procStats(inst) : { appSince: null, cpu: 0, ram: 0, appRam: 0, dbRam: 0, readBps: 0, writeBps: 0, todayR: 0, todayW: 0, totalR: 0, totalW: 0 };
  return { readBps: Math.round(hr.readBps || 0), writeBps: Math.round(hr.writeBps || 0), todayR: Math.round(hr.todayR || 0), todayW: Math.round(hr.todayW || 0), totalR: Math.round(hr.totalR || 0), totalW: Math.round(hr.totalW || 0), cpu: hr.cpu, ram: hr.ram, appRam: hr.appRam, dbRam: hr.dbRam, memTotal: os.totalmem(), up: os.uptime(), appSince: hr.appSince, disk: { data: diskOf(inst.data || inst.root || '.'), root: inst.root ? diskOf(inst.root) : null } };
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
    '== Gabimet e dashboard-it (të fundit) ==', ...readErrorEntries(20).map((e) => e.at + ' · ' + e.where + ' · ' + e.message), '',
    '== Updater.log (fundi) ==', tailOf(path.join(inst.root, 'Updater.log'), 60), '',
    '== HRSystem-Server.log (fundi) ==', tailOf(path.join(inst.root, 'HRSystem-Server.log'), 60), '',
    '== Dashboard.log (fundi) ==', tailOf(path.join(inst.root, 'Dashboard.log'), 40),
  ];
  return mask(lines.join('\n'));
}

// A new GitHub token also brings the repository it is allowed to read (owner, 2026-10-22): a fine-grained token is made for one repo, so the repo of
// the installation follows it. `list` = the full names the token can see; only the dashboard's own repo is never the program's repo.
function pickRepo(list, current) {
  const candidates = list.filter((n) => !/HRSystem-(Dashboard|Setup)$/i.test(n)); // the dashboard's and the setup's own repos are never the program's
  if (!candidates.length) return { repo: current, changed: false, choices: [] };
  if (candidates.includes(current)) return { repo: current, changed: false, choices: [] };
  if (candidates.length === 1) return { repo: candidates[0], changed: true, choices: [] };
  if (!current) { const best = candidates.find((n) => /\/HRSystem-/i.test(n) && !/-(Template|Test|Setup)$/i.test(n)) || candidates[0]; return { repo: best, changed: true, choices: [] }; } // no repo saved yet: the token decides
  return { repo: current, changed: false, choices: candidates }; // several: the owner's current repo stays, the choices are told
}
async function followTokenRepo(inst, token) {
  try {
    const r = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hrsystem-dashboard', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const file = path.join(inst.root, 'update.json');
    let upd = {}; try { upd = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none */ }
    const out = pickRepo((await r.json()).map((x) => x.full_name), upd.repo || '');
    if (out.changed) { fs.writeFileSync(file, JSON.stringify({ ...upd, channel: upd.channel || 'stable', repo: out.repo }, null, 4)); latestCache.delete(inst.id); }
    return out;
  } catch { return null; }
}
// ======================= Alerts (owner, 2026-10-22): an old backup, an address that does not open, a test of a backup, a daily report =======================
const STALE_MS = Number(process.env.HR_STALE_MS) || 48 * 3600 * 1000;      // a backup older than this is an alarm (override only for tests)
const ADDR_DOWN_MS = Number(process.env.HR_ADDR_DOWN_MS) || 5 * 60 * 1000;  // an address that does not open for this long is an alarm
const DAILY_HOUR = Number.isInteger(Number(process.env.HR_DAILY_HOUR)) && process.env.HR_DAILY_HOUR !== undefined ? Number(process.env.HR_DAILY_HOUR) : 8;
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// 1) The newest backup is too old (or there is none for two days after the installation): once a day.
function staleBackupCheck(inst) {
  if (!inst.data) return;
  const list = listBackups(inst);
  let age = null;
  if (list.length) age = Date.now() - Date.parse(list[0].time);
  else { try { age = Date.now() - fs.statSync(path.join(inst.root, 'current.txt')).birthtimeMs; } catch { /* unknown */ } }
  if (age === null || age <= STALE_MS) return;
  const cur = readSettings(inst), day = todayKey();
  if (cur.lastStaleAlert === day) return;
  cur.lastStaleAlert = day; settingsWrite(inst, cur);
  const days = Math.max(1, Math.floor(age / 86400000));
  const text = list.length ? 'Backup-i i fundit është ' + days + ' ditë i vjetër (' + list[0].name + ').' : 'Nuk ka asnjë backup prej ' + days + ' ditësh.';
  notify(inst, 'Backup i vjetër', text + ' Kontrollo Automatik te Veprime.', 'warn');
  addHistory(inst, { title: 'Backup i vjetër', ok: false, detail: text });
}

// 3) A public address that does not open for 5 minutes while the application itself runs (a tunnel or a domain problem): one message, one more when it is back.
const addrWatch = new Map(); // url -> { down, told }
async function addressCheck(inst) {
  const w = watch.get(inst.id);
  if (!w || w.down) { addrWatch.clear(); return; } // the application is down: that has its own message
  let env = {}; try { env = readEnv(path.join(inst.root, '.env')); } catch { /* none */ }
  const a = await accessOf(inst, env);
  const urls = new Set((a.domains || []).map((d) => d.url));
  for (const k of [...addrWatch.keys()]) if (!urls.has(k)) addrWatch.delete(k);
  for (const d of a.domains || []) {
    const st = addrWatch.get(d.url) || { down: 0, told: false };
    addrWatch.set(d.url, st);
    const name = d.url.replace(/^https?:[/][/]/, '') + (d.temporary ? ' (e përkohshme)' : '');
    if (d.ok) {
      if (st.told) { notify(inst, 'Adresa u kthye', name + ' hapet përsëri.', 'ok'); addHistory(inst, { title: 'Adresa u kthye', ok: true, detail: name }); }
      st.down = 0; st.told = false;
    } else {
      if (!st.down) st.down = Date.now();
      if (!st.told && Date.now() - st.down >= ADDR_DOWN_MS) {
        st.told = true;
        notify(inst, 'Adresa nuk hapet', name + ' nuk hapet prej ' + Math.round((Date.now() - st.down) / 60000) + ' minutash, edhe pse aplikacioni punon.', 'error');
        addHistory(inst, { title: 'Adresa nuk hapet', ok: false, detail: name });
      }
    }
  }
}

// 2) A backup is tested for real: loaded into a temporary database (hrtest_<time>), checked, and the temporary database is dropped.
function mysqlQuery(cfg, sql, db, utf8 = false) { // utf8: text of people (names, messages) comes back as UTF-8, not in the console's code page
  return run(mysqlPath(), [`--user=${cfg.DB_USER}`, '--protocol=TCP', `--host=${cfg.DB_HOST}`, `--port=${cfg.DB_PORT}`, ...(utf8 ? ['--default-character-set=utf8mb4'] : []), '-N', '-B', '-e', sql, ...(db ? [db] : [])], { MYSQL_PWD: cfg.DB_PASSWORD });
}
function runBackupTest(inst, name) {
  needLocal(inst);
  const found = name && listBackups(inst).find((b) => b.name === name);
  if (!found) throw new Error('Backup-i nuk u gjet.');
  return startJob(inst, 'Test backup: ' + found.name, async (add) => {
    const cfg = readEnv(path.join(inst.root, '.env'));
    const stamp = Date.now(), db = 'hrtest_' + stamp;
    const file = path.join(inst.data, 'Backups', `test-${stamp}.tmp.sql`);
    const record = (ok, extra) => { const cur = readSettings(inst); cur.backupTests = { ...(cur.backupTests || {}), [found.name]: { ok, at: new Date().toISOString(), ...extra } }; const keys = Object.keys(cur.backupTests); if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete cur.backupTests[k]; settingsWrite(inst, cur); };
    let created = false;
    try {
      // Step 1, always: the file itself. Every table of the live database must be in the backup, with its CREATE and (for people) its rows, and the dump must be complete.
      add('1/4 Po kontrollohet skedari: tabelat, rreshtat dhe fundi i tij...');
      const text = fs.readFileSync(path.join(backupDir(inst), found.name), 'utf8');
      const live = (await mysqlQuery(cfg, 'SHOW TABLES', cfg.DB_NAME)).split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
      const missing = live.filter((t) => !text.includes('CREATE TABLE `' + t + '`'));
      if (!live.length) throw new Error('Nuk u lexuan tabelat e databazës aktuale.');
      if (missing.length) throw new Error('Backup-i nuk ka këto tabela: ' + missing.join(', ') + '.');
      if (!text.includes('Dump completed')) throw new Error('Skedari nuk mbaron siç duhet (duket i prerë).');
      const liveUsers = Number(await mysqlQuery(cfg, 'SELECT COUNT(*) FROM `users`', cfg.DB_NAME).catch(() => '0')) || 0;
      if (liveUsers > 0 && !text.includes('INSERT INTO `users`')) throw new Error('Backup-i nuk ka përdorues, ndërsa databaza aktuale ka ' + liveUsers + '.');
      add('   OK: ' + live.length + ' tabela, fundi i skedarit dhe përdoruesit ekzistojnë.');
      // Step 2, when the database user may create a database: the backup is really loaded into a temporary database and counted.
      let real = false, tables = live.length, users = liveUsers;
      try {
        fs.writeFileSync(file, text.replace(/utf8mb4_uca1400_[a-z_]+/g, 'utf8mb4_unicode_ci').replace(/^\s*(CREATE DATABASE|USE)\b.*$/gim, '-- (skipped) $&'));
        add('2/4 Po krijohet një databazë e përkohshme (' + db + ')...');
        await mysqlQuery(cfg, 'CREATE DATABASE `' + db + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        created = true;
        add('3/4 Po ngarkohet backup-i në të dhe numërohet...');
        await mysqlRun(inst, cfg, file, add, db);
        tables = Number(await mysqlQuery(cfg, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}' AND table_type='BASE TABLE'`));
        users = Number(await mysqlQuery(cfg, 'SELECT COUNT(*) FROM `' + db + '`.users').catch(() => '0')) || 0;
        if (tables < live.length) throw new Error('Backup-i u ngarkua, por ka ' + tables + ' tabela nga ' + live.length + '.');
        real = true;
      } catch (e) {
        if (/Access denied|1044|1142|1227/.test(String(e.message)) && !created) add('   Ngarkimi real nuk u bë: përdoruesi i aplikacionit nuk ka të drejtë të krijojë databazë të përkohshme. Kontrolli i skedarit mbetet i vlefshëm.');
        else throw e;
      }
      record(true, { tables, users, real });
      add('SUKSES: backup-i është i plotë: ' + tables + ' tabela, ' + users + ' përdorues' + (real ? ' (ngarkuar dhe numëruar në një databazë të përkohshme).' : ' (kontroll i skedarit; ngarkimi real nuk ishte i mundur).'));
    } catch (e) {
      record(false, { error: String(e.message).slice(0, 160) });
      throw e;
    } finally {
      if (created) { add('4/4 Po fshihet databaza e përkohshme...'); try { await mysqlQuery(cfg, 'DROP DATABASE IF EXISTS `' + db + '`'); } catch { /* next time */ } }
      fs.rmSync(file, { force: true });
    }
  });
}

// 4) The daily report to the phone (08:00, or the first time after 08:00 that the dashboard runs): what is fine and what is not.
async function dailyReportText(inst) {
  const s = await status(inst);
  const problems = [], lines = [];
  lines.push('Aplikacioni: ' + (s.health.ok ? 'online (' + s.health.ms + ' ms)' : 'FIKUR'));
  if (!s.health.ok) problems.push('aplikacioni është i fikur');
  lines.push('Databaza: ' + (s.health.database === 'connected' ? 'lidhur' : (s.health.database || '-')));
  const b = s.backups[0];
  if (b) {
    const days = Math.floor((Date.now() - Date.parse(b.time)) / 86400000);
    lines.push('Backup i fundit: ' + fmtDateTime(b.time) + (b.version ? ' · versioni ' + b.version : '') + ' · ' + (b.check ? 'OK' : 'DËMTUAR'));
    if (!b.check) problems.push('backup-i i fundit është dëmtuar');
    if (Date.now() - Date.parse(b.time) > STALE_MS) problems.push('backup-i është ' + days + ' ditë i vjetër');
  } else { lines.push('Backup: asnjë'); problems.push('nuk ka asnjë backup'); }
  const d = s.system && s.system.disk && s.system.disk.data;
  if (d && d.total) { const pct = Math.round((100 * d.free) / d.total); lines.push('Disku: ' + pct + '% i lirë (' + (d.free / 1073741824).toFixed(0) + ' GB)'); if (pct < 15) problems.push('pak hapësirë në disk'); }
  const doms = (s.access && s.access.domains) || [];
  if (doms.length) { const open = doms.filter((x) => x.ok).length; lines.push('Adresat: ' + open + ' nga ' + doms.length + ' hapen'); if (open < doms.length) problems.push((doms.length - open) + ' adresë nuk hapet'); }
  lines.push('Versioni: ' + ((s.installed && s.installed.name) || '-') + (s.update ? ' · ka version të ri: ' + (s.latest && s.latest.version) : ''));
  return { level: problems.length ? 'warn' : 'ok', title: 'Raporti i ditës' + (problems.length ? ': KUJDES' : ': gjithçka OK'), message: (problems.length ? 'Kujdes: ' + problems.join(', ') + '.\n' : 'Gjithçka në rregull.\n') + lines.join('\n') };
}
const fmtDateTime = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
async function dailyReportCheck(inst) {
  const n = notifyOf(inst);
  if (!n.on || !n.target || !n.daily) return;
  const now = new Date(), cur = readSettings(inst), day = todayKey();
  if (now.getHours() < n.hour || cur.lastDailyReport === day) return;
  cur.lastDailyReport = day; settingsWrite(inst, cur);
  const r = await dailyReportText(inst);
  notify(inst, r.title, r.message, r.level, 'daily');
  addHistory(inst, { title: 'Raporti i ditës u dërgua', ok: true, detail: r.title });
}

// Also by itself: every 10 minutes (and once a minute after the start) the repo the stored token can read is compared with the installation's repo; with exactly one
// repo that is not the installation's own, the installation follows it (a token changed on the PC brings its repo without pressing anything).
async function followStoredToken() {
  for (const inst of instances()) {
    if (!inst.root || !inst.data) continue;
    try {
      const t = await token(inst);
      if (!t) continue;
      const out = await followTokenRepo(inst, t);
      if (out && out.changed) { addHistory(inst, { title: 'Repo i programit ndryshoi', ok: true, detail: out.repo }); notify(inst, 'Repo i programit ndryshoi', 'Tokeni lexon repo-n ' + out.repo + ': instalimi e ndjek.', 'info'); }
    } catch { /* next time */ }
  }
}
setTimeout(() => { followStoredToken().catch(() => {}); }, 60000).unref();
setInterval(() => { followStoredToken().catch(() => {}); }, 600000).unref();
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
  return { id: inst.id, name: inst.name, url: access_domain_or_local(access, inst), autoBackup: autoBackupOf(inst), autostart: inst.root ? await autostartState(inst).catch(() => []) : [], tokenSet, paths: pathsOf(inst, env), access, ownerMissing: !!(setupState && setupState.ready === true), canUninstall: !!uninstallerOf(inst), pinned: pinOf(inst), database: { name: env.DB_NAME || '', host: env.DB_HOST || '', port: env.DB_PORT || '' }, repo: inst.repo || null, channel: inst.channel || null, local: !!inst.root, note: inst.note || '', health: h, installed: i, latest: l, update, backups: withVersions(inst, listBackups(inst).slice(0, 8)).map((b) => ({ ...b, check: checkBackup(inst, b) })), system: sys, usage: usageOf(inst), history: (readSettings(inst).history || []).slice(-100).reverse(), notify: notifyOf(inst), bugsNew: bugNew.get(inst.id) || 0, offsite: offsiteOf(inst), job: jobs.get(inst.id) || null };
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

// Self-repair of the start with Windows (owner, 2026-10-23: after a restart of the PC nothing opened because the tasks were missing): once after each start of
// an INSTALLED dashboard, a MISSING task of the application (at start-up, as SYSTEM) or of the dashboard (at sign-in) is created, and the desktop shortcut
// "HRSystem Dashboard" (it runs Dashboard.bat, which starts the dashboard when it is off, so it works at any time) is made when absent. A task that EXISTS but
// is switched off is never touched: that is the owner's choice (Veprime -> Nisja me Windows).
async function repairAutostart(inst) {
  if (!inst.root || !inst.local) return;
  const root = path.resolve(inst.root), launcher = path.join(root, 'start-hrsystem.ps1'), task = inst.task || 'HRSystem';
  const hasLauncher = fs.existsSync(launcher), bat = path.join(root, 'Dashboard.bat');
  const dashCommand = `Set-Location '${HERE.replace(/'/g, "''")}'; & '${process.execPath.replace(/'/g, "''")}' server.mjs *>> '${path.join(root, 'Dashboard.log').replace(/'/g, "''")}'`;
  const script = [
    "$ErrorActionPreference = 'Stop'; $done = @()",
    hasLauncher ? `if (-not (Get-ScheduledTask -TaskName ${q(task)} -ErrorAction SilentlyContinue)) {
  $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${q('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + launcher + '"')}
  $t = New-ScheduledTaskTrigger -AtStartup; $p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName ${q(task)} -Action $a -Trigger $t -Principal $p -Settings $s -Description 'HRSystem self-hosted server' -Force | Out-Null; $done += 'aplikacioni' }` : '',
    `if (-not (Get-ScheduledTask -TaskName 'HRSystem-Dashboard' -ErrorAction SilentlyContinue)) {
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${q('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "' + dashCommand + '"')}
  $t = New-ScheduledTaskTrigger -AtLogOn -User $me; $p = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Highest
  $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'HRSystem-Dashboard' -Action $a -Trigger $t -Principal $p -Settings $s -Description 'HRSystem Dashboard' -Force | Out-Null; $done += 'dashboard-i' }`,
    fs.existsSync(bat) ? `$desk = [Environment]::GetFolderPath('Desktop'); $pub = Join-Path $env:PUBLIC 'Desktop'
if (-not (Test-Path (Join-Path $desk 'HRSystem Dashboard.lnk')) -and -not (Test-Path (Join-Path $pub 'HRSystem Dashboard.lnk'))) {
  $w = New-Object -ComObject WScript.Shell; $l = $w.CreateShortcut((Join-Path $desk 'HRSystem Dashboard.lnk')); $l.TargetPath = ${q(bat)}; $l.WorkingDirectory = ${q(root)}; $l.WindowStyle = 7; $l.Description = 'HRSystem Dashboard'; $l.IconLocation = 'shell32.dll,13'; $l.Save(); $done += 'shortcut' }
Get-ChildItem $desk, $pub -Filter 'HRSystem Dashboard.url' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue` : '',
    "$done -join ','",
  ].filter(Boolean).join('\n');
  try {
    const out = (await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script])).trim();
    if (out) { addHistory(inst, { title: 'Nisja me Windows u rregullua', ok: true, detail: out }); notify(inst, 'Nisja me Windows u rregullua', 'U krijua: ' + out + '. Pas rinisjes së kompjuterit hapet vetë.', 'info'); }
  } catch (e) { logError('Nisja me Windows', e); }
}
setTimeout(() => { if (INSTALLED_EARLY()) for (const inst of instances()) repairAutostart(inst).catch(() => {}); }, 45000).unref();

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
      // One slow answer (a busy moment of the application or of the PC) is asked once more with a longer wait before the lamp turns red; a refused connection is down at once.
      for (const wait of [2500, 8000]) {
        try {
          const r = await fetch(inst.local + '/api/health', { signal: AbortSignal.timeout(wait), cache: 'no-store' });
          const j = await r.json().catch(() => null);
          ok = r.status === 200 && !!j && j.ok === true; ms = Math.max(1, Math.round(performance.now() - t0)); database = (j && j.database) || null;
          break;
        } catch (e) { ok = false; if (!(e && (e.name === 'TimeoutError' || e.name === 'AbortError'))) break; }
      }
      if (ok) downSeen.delete(inst.id); else downSeen.set(inst.id, Date.now());
    }
    const job = jobs.get(inst.id) || null;
    let backups = [];
    try { backups = inst.data ? listBackups(inst) : []; } catch { backups = []; }
    const inst2 = inst.root ? installed(inst) : null;
    const sig = [job && job.state, job && job.ended, backups.length, backups[0] && backups[0].name, inst2 && inst2.name, quickUrlOf(inst)].join('|');
    return { id: inst.id, ok, ms: ok ? ms : 0, database, sig, job: job ? { title: job.title, by: job.by, state: job.state, started: job.started, ended: job.ended || null, lines: job.lines.slice(-80) } : null };
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
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `mgr=${COOKIE}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' });
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
        statusShared.promise = (async () => ({ instances: await Promise.all(instances().map(status)), dashboard: await dashboardState().catch(() => null), dashboardRepo: DASH_REPO, dashboardVersion: DASH_VERSION, dashboardNotes: DASH_NOTES, errors: { day: errorsLastDay() }, location: serverLocation(), security: { password: SIGN_IN, env: !!process.env.DASHBOARD_KEY }, at: new Date().toISOString() }))();
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
    if (req.method === 'GET' && url.pathname === '/api/errors') {
      const inst = find(url.searchParams.get('id'));
      if (!inst || !inst.root) return send(res, 404, { error: 'Instalimi nuk u gjet.' });
      const out = errorsOf(inst, String(url.searchParams.get('source') || 'dashboard'), Math.min(1000, Number(url.searchParams.get('limit')) || 300));
      return out ? send(res, 200, out) : send(res, 400, { error: 'Burim i panjohur.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/errors-file') {
      const inst = find(url.searchParams.get('id'));
      if (!inst || !inst.root) return send(res, 404, { error: 'Instalimi nuk u gjet.' });
      const source = String(url.searchParams.get('source') || 'dashboard');
      const text = source === 'dashboard' ? (fs.existsSync(ERR_FILE) ? fs.readFileSync(ERR_FILE, 'utf8') : '') : (LOG_FILES(inst)[source] ? tailText(LOG_FILES(inst)[source], 2097152) : null);
      if (text === null) return send(res, 400, { error: 'Burim i panjohur.' });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="gabime-${source}.log"`, 'Cache-Control': 'no-store' });
      return res.end(text);
    }
    if (req.method === 'GET' && url.pathname === '/api/bugs') {
      const inst = find(url.searchParams.get('id'));
      if (!inst || !inst.root) return send(res, 404, { error: 'Instalimi nuk u gjet.' });
      try { needLocal(inst); return send(res, 200, await bugsOf(inst)); } catch (e) { logError('Raportet e gabimeve', e); return send(res, 200, { items: [], counts: { new: 0, progress: 0, solved: 0, roadmap: 0 }, error: 'Raportet nuk u lexuan: ' + String(e.message).slice(0, 160) }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/tools') {
      if (!find(url.searchParams.get('id'))) return send(res, 404, { error: 'Instalimi nuk u gjet.' });
      const inst = find(url.searchParams.get('id'));
      const info = await toolsInfo();
      const ta = inst ? (readSettings(inst).toolAuto || {}) : {};
      return send(res, 200, { ...info, node: { ...info.node, plan: inst ? planView(plannedOf(inst, 'node')) : null }, cloudflared: { ...info.cloudflared, plan: inst ? planView(plannedOf(inst, 'cloudflared')) : null }, auto: { download: ta.download !== false, install: !!ta.install, hour: Number.isInteger(ta.hour) && ta.hour >= 0 && ta.hour <= 23 ? ta.hour : 2 } });
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
        return send(res, 200, setNotify(inst, j.on, j.target, j.daily, j.hour, j.events));
      }
      if (url.pathname === '/api/bug-status') {
        needLocal(inst);
        let body = ''; for await (const c of req) { body += c; if (body.length > 2000) break; }
        let j = {}; try { j = JSON.parse(body); } catch { /* none */ }
        setBugStatus(inst, j.report, j.status);
        const counts = (await bugsOf(inst)).counts;
        return send(res, 200, { ok: true, counts });
      }
      if (url.pathname === '/api/notify-test') {
        needLocal(inst);
        const n = notifyOf(inst);
        try { await sendNotify(n.target, composeNote(inst, 'Njoftimet punojnë', 'Ky është një mesazh prove nga dashboard-i.', 'ok')); } catch (e) { return send(res, 400, { error: e.message }); }
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
      if (url.pathname === '/api/dashboard-password-show') {
        // The current password, for the Settings page (the request is already signed in: with a password set, nobody else reaches this).
        if (!SIGN_IN || process.env.DASHBOARD_KEY) return send(res, 200, { password: null });
        return send(res, 200, { password: LOGIN_KEY });
      }
      if (url.pathname === '/api/dashboard-logout') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': 'mgr=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        return res.end('{"ok":true}');
      }
      if (url.pathname === '/api/dashboard-password') {
        let body = ''; for await (const c of req) { body += c; if (body.length > 1000) break; }
        let j = {}; try { j = JSON.parse(body); } catch { /* none */ }
        // With a password already set, the CURRENT one must be given to change or remove it (5 wrong in a minute lock it for a minute, as the sign-in).
        if (SIGN_IN) {
          const now = Date.now();
          failures = failures.filter((t) => now - t < 60000);
          if (failures.length >= 5) return send(res, 429, { error: 'Shumë provime. Prit një minutë.' });
          if (!sameText(String(j.current || ''), LOGIN_KEY)) { failures.push(now); return send(res, 403, { error: 'Fjalëkalimi aktual nuk është i saktë.' }); }
        }
        try { setDashboardPassword(j.password); } catch (e) { return send(res, 400, { error: e.message }); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(SIGN_IN ? { 'Set-Cookie': `mgr=${COOKIE}; HttpOnly; SameSite=Strict; Path=/` } : { 'Set-Cookie': 'mgr=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }) });
        return res.end(JSON.stringify({ password: SIGN_IN }));
      }
      if (url.pathname === '/api/errors-clear') { try { fs.rmSync(ERR_FILE, { force: true }); } catch { /* none */ } errCount = { at: 0, n: 0 }; return send(res, 200, { ok: true }); }
      if (url.pathname === '/api/backup-test') { needLocal(inst); return send(res, 200, runBackupTest(inst, url.searchParams.get('name'))); }
      if (url.pathname === '/api/daily-report') {
        // The report now (the same text as the daily one at 08:00): sent to the phone when the notifications are on, and shown here.
        needLocal(inst);
        const r = await dailyReportText(inst);
        const n = notifyOf(inst);
        notify(inst, r.title, r.message, r.level, 'daily');
        return send(res, 200, { title: r.title, message: r.message, sent: !!(n.on && n.target) });
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
        const followed = await followTokenRepo(inst, given);
        return send(res, 200, { ok: true, repo: followed && followed.repo, changed: !!(followed && followed.changed), choices: (followed && followed.choices) || [] });
      }
      if (url.pathname === '/api/tunnel-remove') return send(res, 200, removeTunnel(inst));
      if (url.pathname === '/api/tool-download') return send(res, 200, toolDownload(inst, String(url.searchParams.get('what') || '')));
      if (url.pathname === '/api/tool-install' || url.pathname === '/api/tool-update') return send(res, 200, toolInstall(inst, String(url.searchParams.get('what') || '')));
      if (url.pathname === '/api/tool-schedule') { const at = url.searchParams.get('at'); return send(res, 200, toolSchedule(inst, String(url.searchParams.get('what') || ''), at === 'none' ? null : at)); }
      if (url.pathname === '/api/tool-auto') {
        needLocal(inst);
        const cur = readSettings(inst); const hh = parseInt(url.searchParams.get('hour'), 10); cur.toolAuto = { download: url.searchParams.get('download') !== '0', install: url.searchParams.get('install') === '1', hour: Number.isInteger(hh) && hh >= 0 && hh <= 23 ? hh : 2 };
        settingsWrite(inst, cur);
        return send(res, 200, cur.toolAuto);
      }
      if (url.pathname === '/api/tunnel-token') {
        let body = '';
        for await (const c of req) { body += c; if (body.length > 4000) break; }
        let given = '';
        try { given = String(JSON.parse(body).token || ''); } catch { /* wrong body */ }
        return send(res, 200, runTunnel(inst, given));
      }
      if (url.pathname === '/api/address-remove') {
        needLocal(inst);
        const target = String(url.searchParams.get('host') || '');
        if (!/^https:[/][/][A-Za-z0-9.-]+$/.test(target)) return send(res, 400, { error: 'Adresë e pavlefshme.' });
        if (target === quickUrlOf(inst) || target === (readSettings(inst).quickLast || {}).url) { stopQuick(inst); }
        const cur = readSettings(inst);
        if (cur.domainsSeen) delete cur.domainsSeen[target];
        cur.domainsHidden = [...new Set([...(cur.domainsHidden || []), target])].slice(-50); // also hides the one from .env and keeps a still-running name from coming back
        settingsWrite(inst, cur);
        domainHealth.delete(target);
        return send(res, 200, { ok: true });
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
    logError('HTTP ' + req.method + ' ' + (req.url || '').split('?')[0], e);
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
// The address must stay the same (owner, 2026-10-22: it changed at every start). A random system port (port 0) lies in Windows' dynamic range, which is also
// used by outgoing connections and by the previous process of a self-restart, so it was lost again and again. Now: the saved port if it is in 3500-3599,
// otherwise 3500; a taken port is retried for ~10 s (the old process is still closing), then the next one (3501 ... 3599); only then the system picks one.
function pickPort() { const s = savedPort(); return s >= 3500 && s <= 3599 ? s : 3500; }
function listen(port, tries = 0) {
  const onError = (e) => {
    server.removeListener('listening', onListening); // a failed try must not leave its callback behind (it would run once per try)
    if (e.code === 'EADDRINUSE' && port !== 0 && !PORT_FORCED) {
      if (tries < 10) setTimeout(() => listen(port, tries + 1), 1000);
      else listen(port < 3599 ? port + 1 : 0);
    } else if (e.code === 'EADDRINUSE' && port !== 0) listen(0);
    else { console.error('HRSystem Dashboard: ' + e.message); process.exit(1); }
  };
  const onListening = () => {
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
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '127.0.0.1');
}
listen(PORT_FORCED ?? (INSTALLED ? pickPort() : 3700));

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
