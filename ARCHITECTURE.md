# Dashboard (manager) — architecture and rules, for Claude

Read this first when working on the dashboard. `README.md` here is the user-facing feature list (Albanian). This file is how it is built and how to change it safely.
Last updated: 2026-10-22.

## What it is
A local control panel for an HRSystem installation on the owner's PC (health, speed, backups, updates, versions, logs, errors, notifications).
Dependency-free Node (`server.mjs`, ~1900 lines) + one static page (`public/index.html`, ~1350 lines, vanilla JS, no build step).
It is **local only**: it never watches or touches the live site (Hostinger / staff.butikuregina.com). Do not add features that do.

## Where things are
| Place | What |
|---|---|
| `Setup/Claude Studio/manager/` | the working copy (edit here) |
| GitHub `rogestshalaa/HRSystem-Dashboard` (public, `main`) | the published copy: `server.mjs`, `public/index.html`, `README.md`, `Dashboard.bat`, `instances.example.json`, `root/` (PowerShell scripts of the installation root: `hr-common.ps1`, `updater.ps1`, `sql-import.ps1`) |
| `C:\HRSystem\manager\` | the installed copy; equals the repo. Never hand-edit; it self-updates |
| `C:\HRSystem\dashboard-settings.json` | all dashboard settings and state (see below) |
| `C:\HRSystem\dashboard-url.txt` | the port of the running dashboard (random, e.g. 56308) |
| `manager/dashboard-errors.log` | the dashboard's own runtime errors (JSON lines, ~1500 kept) |
| `manager/dashboard.key` | optional sign-in password (hash); delete the file = no password |

Publishing a dashboard-only change (owner's standing order, no asking, **only the Dashboard repo**, not Regina/Template): clone the repo to the scratchpad, copy `server.mjs`, `README.md`, `public/index.html` (and any `root/` script you changed), commit with the Co-Authored-By line, push, then copy the same files to `C:\HRSystem\manager`. Installed dashboards pick it up within 10 minutes.
Installer scripts (`Setup/Claude Studio/installer/`) stay in `Setup` and are not pushed to repos, except the three `root/` scripts.

## Runtime
- Started by `Dashboard.bat` / the Windows scheduled task, elevated, listens on **127.0.0.1 only**; any other `Host` header gets 403.
- Every run makes a random `SESSION_KEY` (embedded in the served HTML); every POST needs it as `X-Manager-Key` (403 otherwise). GETs of state need no key.
- Optional password (`dashboard.key`): login page + session cookie; 5 wrong tries lock for a minute.
- `MANAGER_PORT` env fixes the port (tests use 3500). **The server caches `index.html` at start: restart it after editing the page.**
- Instances: found from `C:\HRSystem` (or `instances.json`). `inst.root` = install folder, `inst.data` = backups, `needLocal(inst)` guards local-only actions.

## server.mjs map (search the section comments)
- Error logs: `logError`, `readErrorEntries`, `tailText`, `errorsOf` (routes `/api/errors`, `/api/errors-file`, `/api/errors-clear`).
- Jobs (update, SQL import): run in the background, the page polls `/api/job`.
- Rollback to an older program version (`/api/rollback`), versions list (`/api/versions`).
- Where everything is (`status(inst)` builds the big status object), domains/tunnels (`learnDomains`, quick tunnel = hidden cloudflared, `/api/quick-tunnel`).
- Self-update from the public repo: compares git blob hashes, applies, keeps `.previous/`, writes `server.mjs` last, a guard process restores the old files if the new one does not answer in 25 s. Only files that already exist locally are replaced.
- Professional extras: history (last 200), notifications (`notify`, `composeNote`, `sendNotify`, levels critical/error/warn/ok/info; ntfy topic or webhook), off-PC backup copy, backup check, disk/resources, password, diagnostics file.
- Alerts: `staleBackupCheck` (>36 h), `addressCheck` (down 5 min), `runBackupTest` (loads a dump into a temp DB, checks, drops it), `dailyReportText/Check` (hour = `notify.hour`, default 8, chosen on the Actions page).
- Start with Windows (autostart per part), Live (`/api/live` SSE, one 3 s pulse while a page is open), `serverLocation()` (country, Cloudflare colo, IP, host).
- `watchTick` every 30 s: app health, self-heal restart (not after a manual Stop), disk, stale backup, address check, daily report.
- Other timers: auto backup (60 s tick, hour in settings), off-PC sync 5 min, token-follow 10 min, version recording 10 min, process stats 20 s, quick tunnel check 20 s.
- Router at the bottom: GET routes first, then `POST /api/*` behind the key check. Thrown errors become `400 {error}` and are logged.

## Settings keys (`dashboard-settings.json`)
`notify {on,target,daily,hour}`, `offsite`, `history`, `autoUpdate*`, `autoBackup*`, `versionLog`, `backupVersions`, `backupTests`, `pinned`, `domainsSeen/Hidden`, `quickLast`, `quickWanted`, `ioDay/netDay`, `lastStaleAlert`, `lastDailyReport`, `manualStop`. Edit by code (`readSettings`/`settingsWrite`), not by hand while running.

## public/index.html map
- `pages.home | data | actions | backup | files | help | settings | errors | history | log`; menu array with icons; `render()` rebuilds the current page from `state.data` (the `/api/status` object), refreshed by SSE.
- Helpers: `el()`, `sw()` (switch), `item()`, `pill()`, `call(name, query, okMsg)` (POST with the key + toast), `postJson`, `toast`, `header`.
- **Languages: Albanian (source text), English, Serbian.** Every UI string is Albanian in the code; `TR_LIST` rows `[sq, en, sr]` build `TR_EXACT` and `TR_FRAG`; `t()` tries an exact match, then whole-word fragments (regex with Unicode word boundaries, so a fragment never matches inside a word). **Any new visible text needs a TR_LIST row**, and so does any message the server generates (history titles, notification text, job output). The Help page has three full guides (sq/en/sr) in `HELP`.
- Accessibility (WCAG 2.2 AA): do not remove the Settings → Accessibility options, focus styles, 44 px targets, status symbols next to colours.
- Theme: light/dark/auto with CSS variables; must work at phone width (375 px).

## Rules when changing it
1. Edit with the Edit tool or byte-safe writes (the files use CRLF in places; Python text mode or a shell `sed` over backslashes has broken them before). Keep `\\` inside JS strings intact.
2. After editing: `node --check server.mjs`; extract the `<script>` of `index.html` and `node --check` it; restart the test dashboard (`MANAGER_PORT=3500 node server.mjs` in `manager/`, kill it afterwards) and click every page in sq/en/sr, light/dark, phone width; check the browser console and the Gabimet page.
3. Tests send **real** ntfy messages to the owner's phone unless `notify.on` is false; restore `dashboard-settings.json` (notify on, no fake domains, no test keys) when done, and never leave test servers or `dashboard.key` behind.
4. Never run uninstall, stop, restore or SQL import against the real `C:\HRSystem` while testing; use a sandbox on C: (never D:).
5. Never touch Hostinger, staff.butikuregina.com, Cloudflare zone settings or the live database from the dashboard.
6. Keep it dependency-free (Node built-ins only) and keep `127.0.0.1`-only.
7. Reply to the owner in Albanian, short; list only what needs his action.

## Known limits (not tested)
Real clean install through the wizard, real uninstall, a real phone, screen readers, MariaDB.
