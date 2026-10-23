# HRSystem Dashboard ("manager") — complete technical reference for Claude

Audience: a future Claude session. Read this whole file before touching anything in `manager/`.
`README.md` (same folder) is the owner-facing feature list in Albanian. This file is the engineering truth.
Last updated: 2026-10-22. If you change behaviour, update this file in the same turn.

---------------------------------------------------------------------------

## 1. TL;DR

- A **local-only control panel** for an HRSystem installation (Regina.HR: PWA + Node server + MySQL) on the owner's Windows PC.
- Shows health/speed/backups/versions/logs/errors; can update, back up, restore, roll back, stop/start the app, send phone notifications.
- Two source files do almost everything: `server.mjs` (Node, no dependencies, ~1900 lines) and `public/index.html` (vanilla JS + CSS, ~1350 lines, no build step).
- Runs elevated, bound to `127.0.0.1`, protected by a per-run key (+ optional password).
- Updates itself every 10 min from the public GitHub repo `rogestshalaa/HRSystem-Dashboard` with automatic rollback.
- UI languages: Albanian (source), English, Serbian.

### Hard rules (never break)
1. **Local only.** Never add anything that watches, probes or changes the live site (Hostinger, staff.butikuregina.com), Cloudflare zone settings, or the live database. Probing the installation's *own* public address for the address-down alert is the only outward check.
2. **Never use drive D:** (the owner's external HDD). Everything lives on C:.
3. Never type/ask for the owner's passwords. Never print tokens/secrets (they are masked).
4. Dashboard-only changes publish **only** to the Dashboard repo (no asking). Program (`Source/`) changes are a different workflow (ask which repos). Installer scripts (setup, update, uninstall, SQL import) live ONLY in `Setup/Claude Studio/installer/` and the Setup zip; no repo carries them (owner, 2026-10-22: each repo holds only its own system).
5. Reply to the owner in **Albanian, short**; the closing list ("Lista jote") contains only things that need his action now.
6. Stay dependency-free (Node built-ins only) and `127.0.0.1`-only.

---------------------------------------------------------------------------

## 2. Where everything lives

| Path / place | What it is |
|---|---|
| `Setup/Claude Studio/manager/` | **Working copy. Edit here.** |
| GitHub `rogestshalaa/HRSystem-Dashboard`, branch `main` (public) | Published copy: `server.mjs`, `public/index.html`, `README.md`, `ARCHITECTURE.md`, `Dashboard.bat` (only the dashboard: no installer scripts; `instances.example.json` stays local) |
| `C:\HRSystem\manager\` | Installed copy (== repo). Self-updates. **Never hand-edit** except when deploying right after a publish (copy the same files). Only files that already exist there are replaced by self-update (new files such as ARCHITECTURE.md are not installed). |
| `C:\HRSystem\` | The installation root: `.env` (DB + secrets), `update.json`, `start-hrsystem.ps1`, `updater.ps1`, `hr-common.ps1`, `sql-import.ps1`, `Uninstall.bat`, `HRSystem-Server.log`, `Updater.log`, `Dashboard.log`, `dashboard-url.txt` (port), `dashboard-settings.json`, `github.token` (DPAPI-encrypted), `releases/`, `current.txt` |
| `C:\HRSystem\dashboard-settings.json` | All dashboard settings/state (section 7). |
| `manager/dashboard-errors.log` | Dashboard's own runtime errors, JSON lines (about 1500 kept). |
| `manager/dashboard.key` | Optional sign-in password (hash). Delete it = no password. |
| `manager/.previous/` | Files kept by the last self-update, for rollback. |
| `Setup/Claude Studio/installer/` | Windows setup scripts (`Install.bat`, `installer.ps1`, `wizard.ps1`, `updater.ps1`, `sql-import.ps1`, `uninstall.ps1`, `uninstall-wizard.ps1`, `hr-common.ps1`). PowerShell 5.1: **a script with non-ASCII text must have a UTF-8 BOM** (wizard/installer/uninstall have it). |
| `Setup/Claude Studio/scripts/pack.py` | Builds release zips (program, not dashboard). |
| `Setup/Versions/`, `Regina Center SHPK/` | Program releases and the client project (not dashboard). |

Ports: the installed dashboard has a FIXED port (since 2026-10-22): the saved one if it is in 3500-3599, otherwise 3500; a taken port is retried for ~10 s (the previous process of a self-restart is still closing) and then 3501, 3502 … (a random system port used to be chosen and the address changed at every start). The address is written to `dashboard-url.txt` and to the desktop shortcut. A development copy (not installed) and tests use 3700 (`MANAGER_PORT=3700`). The real app listens on 3000. The test MySQL used by program tests is 3399 (scratchpad datadir, root pw `x`).

---------------------------------------------------------------------------

## 3. Runtime model and security

- Started by Windows (scheduled task / `Dashboard.bat`), **elevated**, listens **only on 127.0.0.1**. A request with any other `Host` header gets 403.
- On each start a random `SESSION_KEY` is generated and embedded in the served HTML. Every `POST /api/*` needs header `X-Manager-Key: <SESSION_KEY>` (403 otherwise; the page reloads itself once after a dashboard restart to pick up the new key).
- Plain GETs (status, errors, files lists) need no key. No path comes from the user for file operations: deletes/downloads/opens map a name against an internal list (path traversal returns 404).
- Optional password (`dashboard.key`): login page + session cookie valid while the browser stays open; 5 wrong tries lock for a minute; change requires the current one; "Hiq fjalëkalimin" removes it. `DASHBOARD_KEY` env var also works (cannot be changed from the UI).
- Request bodies are capped (small JSON 2–4 KB; SQL 50 MB; import 300 MB).
- Thrown errors in the router become `400 {error}` and are logged with `logError`.
- **`index.html` is read once at start. After editing the page, restart the server** (a stale page is the #1 false "my change doesn't work").

---------------------------------------------------------------------------

## 4. Backend map (`server.mjs`)

Search the section comments (`// ======`, `// ----`). Order in the file, roughly:

| Section | Key functions | Notes |
|---|---|---|
| Error logs | `logError`, `readErrorEntries`, `errorsLastDay`, `tailText`, `errorsOf`, `LOG_FILES` | UTF-16 logs (PowerShell redirects) are detected by NUL bytes. Sources: `dashboard`, `app`, `updater`, `dashboardlog`. |
| Backups | `backup`, `backupRaw` (mysqldump to `<data>/backups`), `listBackups`, `checkBackup` (ends with mysqldump's closing line), `withVersions` (adds program version + `tested`) | |
| Jobs | `startJob`, `jobs` Map, `runUpdate`, `spawnUpdater` | One job per instance at a time; the page polls `/api/job`; output lines kept (200). |
| Rollback | `versionsOf`, `rollbackRepo` | Go back to an older program version (from repo Releases) or restore a backup (`/api/backup-restore`). |
| Instances/paths | `instances()`, `find(id)`, `needLocal(inst)`, `pathsOf`, `readEnv` | Without `instances.json` one instance is auto-detected from the install root. |
| Settings | `readSettings`, `settingsWrite` | JSON file, read on demand. Never edit by hand while running. |
| Domains/tunnels | `learnDomains`, `normalizeDomain`, `addressCheck`, quick tunnel (hidden cloudflared; `startQuick`), `removeTunnel`, `/api/tunnel-token` | Temporary `*.trycloudflare.com` address changes on every restart; the phone is told the new one. |
| System control | `systemAction(inst, 'start'|'stop'|'restart')` | Stop = scheduled task, then the launcher `start-hrsystem.ps1` (it restarts node after 3 s), then node. Start = the task, else a new launcher. Sets `manualStop` so self-heal stays quiet. |
| Dashboard self-update | `dashboardDiff`, `updateDashboard`, `autoUpdateDashboard`, `gitBlobSha` | Compares GitHub tree blob hashes with local files, downloads changed ones, backs up to `.previous/`, writes `server.mjs` **last** (that restarts it), guard process restores old files if the new dashboard does not answer within 25 s. It never touches the installer scripts in the install root. |
| Extras | `addHistory` (last 200), notifications, off-PC copy (`syncOffsite`), disk/resources, password, `diagnostics` (one .txt, secrets masked) | |
| Notifications | `notify(inst,title,msg,level)`, `composeNote`, `sendNotify`, `NOTE_LEVELS`, `setNotify`, `notifyOf`, `hourOf` | Levels: critical, error, warn, ok, info. Target = ntfy topic (owner's: `hrsystem-home`) or https webhook. Title is "<company> · <what>", body ends with time. **Real messages reach the owner's phone during tests.** |
| Watcher | `watchTick` every 30 s | App health, self-heal restart (not after manual Stop; retries at most every 10 min), disk, stale-backup alert, address alert, daily report. |
| Alerts | `staleBackupCheck` (>36 h, env `HR_STALE_MS`), `addressCheck` (down 5 min, `HR_ADDR_DOWN_MS`), `runBackupTest` (loads dump into a temp DB via `mysqlQuery`, checks, drops it), `dailyReportText/Check` (hour = `notify.hour`, default 8, env `HR_DAILY_HOUR`) | The daily report is sent once per day, at the chosen hour or the first time the dashboard runs after it. |
| Autostart | `autostartState`, `setAutostart` | Per part (app, database, tunnel, dashboard) or all. |
| Live | `/api/live` (SSE), `liveClients` | While a page is open, one light pulse every 3 s (app down: every 15 s). |
| Status | `status(inst)` | Builds the big object the page renders; cached 3 s in `statusShared`. |
| Router | bottom of file | GET routes first; then `if POST … X-Manager-Key` check; `needLocal` for anything touching the PC. |

### Status object (`GET /api/status`)
`{ instances: [ { id, name, url, health, installed, latest, update, backups[{…, check, tested, versions}], system, usage, history[100], notify{on,target,daily,hour}, offsite, job, autoBackup, autostart[], tokenSet, paths, access, ownerMissing, canUninstall, pinned, database, repo, channel, local, note } ], dashboard, dashboardRepo, errors{day}, location{ip,country,colo,host,zone}, security{password,env}, at }`

### API routes
GET: `/api/status`, `/api/live` (SSE), `/api/job`, `/api/versions`, `/api/errors?id&source&limit`, `/api/errors-file`, `/api/backup-file` (download), `/api/diagnostics`.
POST (all need the key; `?id=<instance>` selects the instance, 404 if unknown):
`backup`, `backup-delete`, `backup-restore`, `backup-test`, `open-folder`, `open`, `import` (SQL backup upload), `sql` (run SQL), `update`, `rollback`, `system?do=start|stop|restart`, `autostart`, `auto-backup`, `github-token`, `secrets`, `setup-link`, `developer-open`, `quick-tunnel`, `tunnel-token`, `tunnel-remove`, `address-remove`, `unpin`, `notify`, `notify-test`, `daily-report`, `offsite`, `offsite-sync`, `errors-clear`, `dashboard-update`, `dashboard-password`, `dashboard-password-show`, `dashboard-logout`, `uninstall`.

---------------------------------------------------------------------------

## 5. Frontend map (`public/index.html`)

- Single page. Menu: Pasqyra (home), Të dhënat (data), Veprime (actions), Backup-et, Vendndodhja (files), Gabimet (errors, red count badge = errors in 24 h), Log-u, Historiku, Si ta përdorësh (help); Cilësimet (settings) in the footer/menu.
- Pages are functions: `pages.home | data | actions | backup | files | help | settings | errors | history | log`. `render()` rebuilds the current page from `state.data` (the status object); SSE `/api/live` and a poll refresh it. `load()` re-fetches status.
- Helpers: `el(tag, attrs, ...children)`, `sw(label, checked, onChange)` switch, `item(title, hint, control)`, `pill(kind, text)`, `call(name, query, okMsg)` (POST with key + toast, returns JSON or false), `postJson(name, body)`, `toast(msg, isError)`, `header(title, sub, actions)`, `fmtTime`.
- Persistence in the browser: `localStorage` keys `lang` (`sq|en|sr`, default `sq`), `section` (current page), theme and accessibility options.
- **i18n:** all UI source strings are Albanian. `TR_LIST` rows `[sq, en, sr]` build `TR_EXACT` (whole string) and `TR_FRAG` (fragments). `t(s)` = exact match, else whole-word fragment replacement (regexes with Unicode lookarounds, built once per language by `fragRegexes`) so a fragment never matches inside a longer word. **Every new visible string needs a TR_LIST row. Every message generated by the server (history titles, notification text, job output, error messages) needs one too**, otherwise English/Serbian show a mixed-language line. The Help page has three complete guides in `HELP` (sq/en/sr): update them when a feature changes.
- Accessibility (WCAG 2.2 AA) is a requirement: 44 px targets, strong focus rings, status symbols beside colours, no motion-only cues, pause for live updates, text spacing, forced-colors support. Don't regress it.
- Theme: CSS variables, light/dark/auto; must be usable at 375 px width.

---------------------------------------------------------------------------

## 6. Key flows (how things actually work)

- **Backup:** `/api/backup` → `mysqldump` (`--single-transaction`, utf8mb4) to `<data>/backups/<name>.sql` → `checkBackup` → history entry → optional off-PC copy. Auto backup runs at `autoBackupHour` (default 2), keeps `autoBackupKeep` (7). Failure → error notification + history.
- **Backup test:** creates temp DB, loads the dump, counts tables/users, drops the DB; result stored in `backupTests`, shown as "I provuar".
- **Update of the program:** `runUpdate` → `updater.ps1` (reads `update.json` {repo, channel}; `stable` = newest non-pre-release, `test` = newest incl. pre-releases) → backup, build, migrations, health check, automatic return on failure. Release asset name: `HRSystemV<x>-Hostinger.zip` up to 1.0.1, `HRSystem-<x>.zip` from 1.0.2 (both accepted).
- **Self-heal:** app down >1 min and not manually stopped and autostart on → start it, notify.
- **Address alert:** each learned public domain is requested every 30 s; 5 min down → alert, back → "Adresa u kthye".
- **Daily report:** composed from health, backup age/test, disk, addresses, version; level ok/warn/error by content.

---------------------------------------------------------------------------

## 7. Settings file keys (`dashboard-settings.json`)

`notify {on, target, daily, hour}`, `offsite {path, on}`, `offsiteLast`, `history[]`, `autoUpdate`, `autoUpdateHour`, `autoUpdateLast`, `autoBackup`, `autoBackupHour`, `autoBackupKeep`, `autoBackupLast`, `versionLog[]`, `backupVersions{}`, `backupTests{}`, `pinned`, `domainsSeen{}`, `domainsHidden[]`, `quickLast`, `quickWanted`, `ioDay` / `netDay` (traffic counters), `lastStaleAlert`, `lastDailyReport`, `manualStop`. Change through the code paths above, not by hand while the dashboard runs.

---------------------------------------------------------------------------

## 8. How to change something (checklist)

1. Edit with the **Edit tool** (or byte-safe writes). Files may contain CRLF and `\\` sequences; shell here-docs/Python text mode have corrupted backslashes and line endings before. After a Python rewrite check `git diff`-style that nothing else moved.
2. New UI text → TR_LIST row (en + sr) and, if it is in a guide, the three `HELP` texts. New server message → TR_LIST row.
3. Syntax checks: `node --check server.mjs`; extract the last `<script>…</script>` of `index.html` to a temp file and `node --check` it.
4. Run a **test dashboard**: in `manager/` run `MANAGER_PORT=3700 node server.mjs` (hidden/background), restart it after every edit. Open it in the Browser pane. Note: a test dashboard needs the real install root to show an instance, otherwise it says "no installation found".
5. UI QA: every page × `sq`/`en`/`sr` × light/dark × phone width (resize_window mobile) ; read the console (no errors) and the Gabimet page; in `en`/`sr` scan the page text for leftover Albanian words.
6. API QA for new routes: no key → 403, bad id → 404, malformed JSON → 400, oversized body → 413/400, never a stack trace to the client.
7. **Tests send real phone notifications** unless `notify.on` is false. Afterwards restore `dashboard-settings.json` (notify on, no fake domains such as `no-such-host.invalid`, no test keys), delete test `dashboard.key`, stop test servers (the dashboard on 3500, `mysqld` on 3399), and confirm the real app on 3000 is up.
8. Never run uninstall / stop / restore / SQL import against the real `C:\HRSystem` while testing; use a sandbox on C:.
9. Update `README.md` (Albanian, features) and this file.
10. Publish (dashboard-only, no asking): clone the repo into the scratchpad (`git pull`), copy `server.mjs`, `public/index.html`, `README.md`, `ARCHITECTURE.md`, `git commit` with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, `git push origin HEAD`. Then copy the same files to `C:\HRSystem\manager` (or wait ≤10 min for self-update). Verify: the installed dashboard's `/api/status` shows your new fields.

---------------------------------------------------------------------------

## 9. Gotchas learned the hard way

- Stale page after editing `index.html` (cached at start) → restart the server.
- Stopping "only node" does not stop the app: the launcher restarts it. Always use `systemAction`.
- Windows PowerShell 5.1 + non-ASCII text without BOM = mojibake. Keep BOMs; avoid `&&`, ternaries, `?.` in `.ps1`.
- WMI/CIM hidden-window process starts need correct syntax; the quick tunnel runs hidden (no console windows popping up).
- A comment placed before code on the same line swallows the code; duplicate object keys are silent.
- Fragment translation inside words caused "Application nuk përgjigjet" — fixed with word-boundary regexes; keep exact rows for generated sentences.
- Cookies ignore ports, so the dashboard can hand a session cookie to the app on another 127.0.0.1 port (used by "open developer").
- GitHub token for the installation is fine-grained, Contents read-only, one repo. The dashboard's own repo is public and needs no token.

---------------------------------------------------------------------------

## 10. Not yet verified (be honest in reports)

Real clean install through the wizard on a blank PC, real uninstall, a real phone (layout and notifications on iOS/Android), screen readers (NVDA/VoiceOver), MariaDB, Windows Home vs Pro differences.

---------------------------------------------------------------------------

## 11. Current state and history (update this at the end of every dashboard task)

State on 2026-10-22 (Dashboard repo `main`, installed copy equal):
- Features done: password (set once, show/hide, change, remove), accessibility (WCAG 2.2 AA), three languages, hidden quick tunnel, self-update with rollback, off-PC backup copy, version log per backup, rollback of the program, **error logs page (Gabimet)**, **server location**, **alerts** (old backup >36 h, address down 5 min), **backup test**, **daily report with an hour chosen by the owner** (Veprime → Njoftime), professional notifications (levels, titles, time), live SSE.
- QA done 2026-10-22: API matrix (key/host/traversal/JSON/size), all pages in sq/en/sr (no mixed language, no console errors), installer scripts parse (PowerShell 5.1), BOM fix for `installer.ps1`/`uninstall.ps1`, setup SQL = migrations 0001-0006 and equals `Setup/Versions/V1.0.1/DatabaseSchema.sql`, zips clean.
- Program release at that time: V1.0.1 (versions go up from now: 1.0.2, 1.0.3 …; asset `HRSystem-<x>.zip` from 1.0.2).
- Owner's standing preferences: short Albanian replies; no live-site (staff) reminders in the closing list; dashboard stays local-only; names in the UI without "HRSystem" prefix; keep the password "Show" behaviour as it is.
- Open ideas, none started: none requested.

- 2026-10-22 (late): notifications also for **a new program version** (`updateAvailableCheck`, one message per version, `lastUpdateNotified`) and **the dashboard's own self-update**; "Përditësimi u krye" already existed (`jobDone`). Uninstall is now a window with **Keep: Database Po/Jo** (see `docs/WINDOWS_SETUP.md`); setup and uninstall windows show the brand "HRSystem". Not tested: the window on a real uninstall of a full installation (engine tested in a sandbox only).

- 2026-10-22 (late): **fixed dashboard port 3500** (see section on ports); tests now use `MANAGER_PORT=3700`.

- 2026-10-22 (late): **the update repo comes from the GitHub token, not from a repo built into the setup** (owner's order; for the Setup zip only, NOT pushed to any repo): `hr-common.ps1` has no default repo any more and gained `Find-RepoFromToken` / `Resolve-UpdateRepo` (used by `updater.ps1`, `installer.ps1`); the setup window asks only for the token (`wizard.ps1` `Find-Repo`); `client.json` in the Setup zip has `"repo": ""`; `manager/server.mjs` `latest()`/`pickRepo` also resolve an empty repo from the token. `pack.py --setup-only <ver>` rebuilds only `Setup/HRSystemV<ver>-Setup.zip` (+ its copy in `Versions/`). **These changes are in `manager/` and `installer/` but NOT in the Dashboard repo** (the installed dashboard would replace its `server.mjs` with the repo copy within 10 min, so do not copy them to `C:\HRSystem` by hand); publish them to the Dashboard repo only when the owner says.

- Pitfall (2026-10-22): never edit `dashboard-settings.json` with PowerShell `Get-Content`/`Set-Content` (PS 5.1 reads UTF-8 as ANSI and double-encodes every Albanian letter in `history`); use `node` (`JSON.parse`/`JSON.stringify`) or `Get-Content -Encoding UTF8`. It happened once and was repaired.

- 2026-10-22 (night): **UI polish v3** (all in the last `<style>` block of `public/index.html` + small JS): Claude's font stack first (`Anthropic Sans`/`Styrene` apply only where installed, else Segoe UI Variable / system-ui), app-like fields (36 px, 9 px radius, hover, focus ring, custom select arrow), warnings (`.banner` with an icon and a coloured edge; `banner run` = info, `#jobbar` = spinner), a toast with icon (ok/err), a **loading screen** (`#boot`, leaves after the first render, shows a retry button when the dashboard does not answer), skeleton lines (`.skel`), a **busy spinner on any button whose handler returns a promise** (a setter on `HTMLButtonElement.prototype.onclick`, spinner after 120 ms, ignores a second click), page fade-in on section change (`pageIn('enter')`) and a short stagger on the first screen (`pageIn('first')`), a compact phone header with a swipeable tab row, a redesigned sign-in page (`LOGIN_HTML` in `server.mjs`). Motion rules used: only transform/opacity, ease-out entrances, exits faster, press `scale(.97)`, hover only with `(hover:hover)`, everything off with reduced motion or the accessibility switch. QA: sq/en/sr, light/dark, 375 px, no horizontal overflow, no console errors (test dashboard on 3700 with a sandbox `instances.json`, removed afterwards).

- 2026-10-22 (night, polish round 2): the browser's `confirm()` / `prompt()` boxes are replaced by **in-page dialogs** (`openDialog`, `confirmAsync`, `promptAsync`; used with `await`; red when the question deletes or replaces data, focus starts on "Anulo" then; Esc / outside click cancels, Enter confirms, Tab stays inside; the busy spinner of the button that opened it is hidden while the dialog is open), roomier toggles, an inline SVG favicon and `theme-color`, and the uninstall question now says that the uninstall window opens. Every new string has sq/en/sr rows.

- 2026-10-23: **the dashboard no longer depends on luck after a restart of the PC.** The cause of "it does not open" was: no Task Scheduler task for the application (missing) and the dashboard task switched off, plus a shortcut that pointed at a raw address. Now: (1) fixed port 3500; (2) `repairAutostart` (45 s after each start of an installed dashboard) creates a MISSING application task (at start-up, SYSTEM) and a MISSING dashboard task (at sign-in) and the desktop shortcut `HRSystem Dashboard.lnk`, which runs `Dashboard.bat` (starts the dashboard when it is off, then opens its address); a task that exists but is switched off is never touched; (3) `manager/Dashboard.bat` delegates to the installation's own `Dashboard.bat` when installed, and the root `Dashboard.bat` finds the installed folder from the tasks when it is run from another folder (e.g. the unpacked setup) instead of saying "not installed". No .exe is needed: an .exe would still need the same autostart.

- 2026-10-23: the installer takes the dashboard from this repo (zip of `main`, no token) instead of the copy in the setup zip; the bundled copy is only an offline fallback.

History (newest first): installer pulls the dashboard from its repo · restart-proof start · UI polish round 2 (dialogs) · UI polish v3 · repos cleaned (each holds only its own system) · token-based update repo (Setup zip only) · fixed dashboard port · new-version + dashboard-update notifications, uninstall wizard · daily-report hour setting · ARCHITECTURE.md · QA + translation boundary fix · error logs/location/alerts/backup test/daily report/notifications · password rework · hidden quick tunnel · app zip name `HRSystem-<x>.zip` · version log per backup · dashboard self-update repo.
- 2026-10-23: **release notes in the dashboard.** `latest()` in `server.mjs` now also returns `notes`: the text of the Release page (GitHub `body`, cut at 4000 characters) of the new version and of every version between the installed one and it (newest first, max 5, only those the channel would install). The overview banner "Ka version të ri" shows them under "Çfarë ka të re" (`releaseNotes()` / `renderNotes()` in `public/index.html`: "- " lines become a list, "#" lines a bold line; styles `.notes`; TR_LIST row added). Read-only: nothing is written to GitHub; versions whose Release has no text show nothing. Tested on a test dashboard (3700) with a sandbox instance at version 1.0.0 reading the Regina repo; not yet published to the Dashboard repo.
- 2026-10-23 (later): **release notes in the phone notifications** and **the night job runs once per day per hour.** (1) The ntfy/webhook message "Ka version të ri" now ends with "Çfarë ka të re:" and the notes (`notesText()`: "- " lines as bullets, max 600 characters; several versions: "Versioni X:" headings); the text is saved in `dashboard-settings.json` as `lastNotes {version,text}` and repeated in "Përditësimi u krye" when that version is the installed one. Tested with a local webhook target (no ntfy) on a sandbox instance. (2) `autoBackupTick`: the run record now keeps `hour`; the job is skipped only when it already ran TODAY AT THE SAME HOUR (an old record without an hour counts as the same), so moving the hour from 01:00 to 19:00 makes it run at 19:00 even if today's run was done (owner moved it to 19:00 and nothing happened because the 01:00 run had been recorded). Not tested end to end on a real update.
- 2026-10-23 (later still): when the job's hour comes and it is skipped because it already ran today at that hour, the reason is written once to the history ("Puna automatike nuk u nis"; `skipNoted`), so "why did it not run?" can be answered from the dashboard.
- 2026-10-23 (dashboard v1.1.0): **the dashboard has its own version and "what is new".** `DASH_VERSION` and `DASH_NOTES` (newest first, plain Albanian) are constants in `server.mjs` (they travel with the file that every self-update replaces; a new JSON file would NOT be installed). **Rule: with EVERY published dashboard change raise `DASH_VERSION` and add an entry to `DASH_NOTES`.** `/api/status` returns `dashboardVersion` + `dashboardNotes`. UI: Veprime card "Dashboard-i · vX" (update button + "Çfarë ka të re", last 3 versions) and a one-time banner on Pasqyra after an update (browser `localStorage` key `dashSeenVersion`). Phone: after a self-update the NEW process (`announceDashboardVersion`, 20 s after start) sends "Dashboard-i u përditësua në vX" with the notes of the versions newer than `dashSeen` in `dashboard-settings.json` (no record = counts as 1.0.0; a brand-new install with no history stays silent); the old process no longer sends its generic "U instaluan N skedarë" message when server.mjs was among the files (otherwise it still does). Tested on a sandbox install (dashboard in `<root>\manager`, local webhook as target): message, banner and card; not yet seen on a real self-update.
- 2026-10-23 (dashboard v1.1.1): **a page "Çfarë ka të re" in the menu** (`pages.whatsnew`, SECTIONS `whatsnew`): the dashboard versions with their notes (all of `DASH_NOTES`) and the program notes when a new program version exists. By the owner's order there is NO "update the dashboard" button (the dashboard updates itself every 10 minutes); the v1.1.0 card on Veprime was removed (the old unused `dashBtn`/`dashText` code stays). The one-time banner after an update on Pasqyra stays.
- 2026-10-23 (dashboard v1.2.0): **redesign.** (1) JetBrains Mono is the face everywhere (`--font`/`--mono`; loaded from Google Fonts by the browser with a `<link>` in the head, the stack falls back to the system monospace faces offline; the accessibility option "readable font" still switches to Segoe). Body 13px. (2) **One set of status colours**, tokens `--st-*` (pure: ok #27D796, bad #F05252, warn #F5B942, info/processing #3478F6, off #737B8C, pending #A78BFA, maintenance #FB923C) and `--t-*` (the same colours as text/icon, a little darker on light pages); `--ok/--okbg/--warn/--warnbg/--bad/--badbg` now map to them (not when colour-blind or high-contrast mode is on). Pills `ok/warn/bad/info/pend/maint/mute`, dots, banners (run = info), progress and spark bars, toasts use them with tinted backgrounds; the pulsing glow of the LIVE badge and the dot glow are gone. An available update is "pending" (purple). (3) Cards: `kh(icon, title, tone)` head with an icon chip (server, db, tag, plug, cpu, disk, activity, box) coloured by state; the address card is now "Lidhja", the database card has an online/offline badge. (4) "Pasqyra" is now **"Kryesore"** (SECTIONS, header, help section, TR rows). (5) **Ctrl+K / Cmd+K search** (`openPalette`, `paletteItems`; button under the installation name): pages, installations (when more than one) and quick actions (`view()` returns `actions`: open app, /developer, backup now, update, refresh, theme); accent-insensitive, arrows/Enter/Esc. Tested on a test dashboard (3700) with the two test-space companies as instances: dark and light, phone width, search and Enter; not looked at by eye: English/Serbian text, the accessibility modes.
