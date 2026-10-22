# HRSystem Dashboard

Program i vogël që hapet vetëm në PC-në tënde (`http://127.0.0.1:3500`, nuk del në internet) dhe tregon **vetëm instalimet që punojnë në këtë PC** (`C:\HRSystem` gjendet vetë; të tjerat vihen në `instances.json`). Hostinger dhe kompjuterat e tjerë nuk shfaqen. Për çdo instalim tregon:

- **Shëndetin** (`/api/health`) dhe **shpejtësinë** (mesatarja e 3 kërkesave, me grafik të të fundit).
- **Versionin e instaluar** (për instalimet në këtë PC) dhe **versionin e fundit në GitHub** të kanalit të tij (`stable` ose `test`). Tregon "Ka version të ri" ose "Ka build të ri" (i njëjti numër, zip i ri).
- **Ekzekuto SQL**: një skedar `.sql` pas backup-it automatik; ndalet te gabimi i parë.
- **Importo databazën**: zëvendëson gjithë databazën me një dump të plotë (p.sh. nga phpMyAdmin i Hostinger): backup automatik, fshin tabelat ekzistuese, ngarkon dump-in dhe ekzekuton migrimet që mungojnë. Kolacionet e reja të MariaDB (`utf8mb4_uca1400_*`) zëvendësohen me `utf8mb4_unicode_ci`; rreshtat `CREATE DATABASE` dhe `USE` anashkalohen. Provuar duke rikthyer vetë backup-in e testit.
- **Backup-et e databazës** dhe butonin **Backup tani** (instalimet në këtë PC): bën `mysqldump` te `<data>\Backups`.
- **Fshirja e një backup-i** (butoni *Fshi* te lista, me konfirmim; vetëm skedarët e listës fshihen).
- **Domenet:** dashboard-i i mëson vetë emrat me të cilët hapet aplikacioni nga interneti (çdo 15 sekonda pyet aplikacionin) dhe i tregon të gjithë me gjendje (hapet / nuk hapet); harrohen pas 14 ditësh pa u parë.
- **Adresa e përkohshme** (butoni *Krijo*): një tunel i shpejtë Cloudflare `https://<fjalë>.trycloudflare.com`, pa llogari dhe pa domen; është proces më vete që mbetet kur riniset dashboard-i; nëse mbyllet (p.sh. rinisja e PC-së), dashboard-i e ngre vetë përsëri me adresë të re (një tunel pa llogari nuk e mban kurrë të njëjtën adresë). *Ndale* e fik dhe nuk e ngre më. Për provë dhe përdorim nga telefoni. Emrat e mësuar nga tuneli që nuk hapen më harrohen menjëherë.
- **Pamja:** font monospace (si terminal), ora në format 24 orësh (dd.mm.yyyy HH:MM), poshtë djathtas "Krijuar nga Rogest Network"; menu anësore (Pasqyra, Adresat, Të dhënat, Veprime, Backup-et, Ku është instaluar, Log-u), përmbajtje deri 1500 px, ngjyra të çelëta ose të errëta sipas Windows.
- **Të dhënat:** porta, databaza (serveri, porta, emri, përdoruesi, fjalëkalimi), çelësat e aplikacionit, tokeni GitHub dhe tokeni i tunelit, me *Shfaq* dhe *Kopjo*; të fshehura derisa t'i shfaqësh. Lexohen vetëm me kërkesë POST me çelësin e këtij hapjeje (jo te `/api/status`).

## Si hapet
Kliko dy herë `Dashboard.bat` (duhet Node.js; GitHub lexohet me `gh` të futur në PC ose me variablën `GITHUB_TOKEN`).

## Instalimet
Lista është te `instances.example.json`. Për ta ndryshuar kopjoje si `instances.json` (ky nuk shkon në GitHub):

| Fusha | Kuptimi |
|---|---|
| `id`, `name`, `url` | emri dhe adresa |
| `repo`, `channel` | repo-ja e klientit dhe kanali (`stable` / `test`) |
| `root`, `data`, `task` | dosja e instalimit, e të dhënave dhe emri i detyrës së Windows (për versionin, backup-in dhe përditësimin) |

Shëndeti matet te porta lokale e aplikacionit (`PORT` te `.env`), pra gjendja reale në këtë PC.

## Siguria
Dashboard-i hapet **pa asnjë çelës** (është i instaluar lokalisht). Nëse ka kompjuter të përbashkët, krijo skedarin `manager/dashboard.key` me një fjalëkalim të gjatë (ose vendos `DASHBOARD_KEY`) dhe hyrja e kërkon një herë; lidhja `http://127.0.0.1:3500/#key=...` hyn vetë. Serveri dëgjon vetëm `127.0.0.1`, refuzon çdo `Host` tjetër dhe backup-in e pranon vetëm me çelësin që gjenerohet në çdo nisje. Përditësimi dhe SQL (me backup automatik para SQL) punojnë vetëm për instalimet në këtë PC dhe kërkojnë konfirmim.

GitHub pyetet më së shumti çdo 5 minuta (çdo minutë pas gabimi); faqja rifreskohet çdo 30 s vetëm kur skeda është e dukshme. "Tuneli Cloudflare" numëron çdo proces cloudflared përveç adresës së përkohshme.

**Përditësimi i dashboard-it (22.10.2026):** dashboard-i ka repon e vet PUBLIKE, `rogestshalaa/HRSystem-Dashboard` (skedarët e dashboard-it në rrënjë: `server.mjs`, `public/index.html`, `README.md`, `Dashboard.bat`). Çdo dashboard i instaluar e kontrollon çdo 10 minuta (dhe 2 minuta pas nisjes), krahason skedarët me hash-in git dhe përditëson vetë ata që ndryshojnë; nuk duhet token. Ndryshimi publikohet vetëm atje. Skedarët e vjetër ruhen te `manager\.previous`, `server.mjs` kontrollohet para se të zëvendësohet, dhe një roje e rikthen versionin e vjetër nëse i riu nuk përgjigjet brenda 25 s. Butoni te Veprime "Përditëso dashboard-in" e bën menjëherë. Vetëm për dashboard-in e instaluar; zëvendësohen vetëm skedarët që ekzistojnë lokalisht.

**Domenet dhe tuneli (22.10.2026):** domeni nuk shkruhet më me dorë: del vetë kur aplikacioni merr kërkesë përmes tunelit dhe harrohet kur nuk hapet më. Te Adresat, "Ndrysho tunelin" (token i ri: hiqet i vjetri, përfshirë proceset e vjetra cloudflared) dhe "Hiq" (heq tunelin nga ky PC); statusi "nuk hapet" shfaqet kur procesi punon por asnjë adresë nuk hapet (p.sh. tuneli u fshi te Cloudflare).

**Paneli /developer (22.10.2026):** butoni "Hap /developer" (Pasqyra dhe Veprime) e hap panelin e aplikacionit të zhbllokuar: dashboard-i dërgon SETUP_TOKEN nga `.env` te aplikacioni në këtë PC dhe i jep shfletuesit cookie-n e sesionit (2 orë); nuk shkruhet token. Vetëm për instalimet në këtë PC.

**Backup dhe përditësim automatik (22.10.2026):** te Veprime zgjedh ti ORËN dhe a është i ndezur. Backup automatik: çdo ditë (parazgjedhje 02:00), ruan `hrsystem-auto-<stamp>.sql` dhe mban vetëm numrin që zgjedh (parazgjedhje 14 më të rejat; backup-et manuale dhe të përditësuesit nuk fshihen kurrë). Përditësim automatik: çdo natë (parazgjedhje 03:00), vetëm kur GitHub ka version ose build të ri; përditësuesi bën gjithmonë backup para ndryshimit dhe kthehet vetë te i vjetri nëse i riu nuk përgjigjet. Rezultati i fundit ruhet te `dashboard-settings.json` dhe shfaqet te Veprime.
