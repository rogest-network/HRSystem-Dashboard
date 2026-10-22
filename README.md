# HRSystem Dashboard

Program i vogël që hapet vetëm në PC-në tënde (`http://127.0.0.1:<port>`, nuk del në internet) dhe menaxhon **instalimin që punon në këtë PC** (folderi mbi `manager/`, p.sh. `C:\HRSystem` ose `D:\Regina`). Hapet me `Dashboard.bat`. Faqja është **LIVE**: një lidhje Server-Sent Events sjell çdo 3 sekonda shëndetin, shpejtësinë dhe progresin e punëve; faqja nuk rivizatohet nëse nuk ka ndryshuar diçka.

## Faqet
- **Pasqyra:** gjendja e aplikacionit (online, ms, grafik), databaza, versioni, adresa; njoftim kur ka version të ri dhe rezultati i punës së fundit.
- **Të dhënat:** adresat (lokale, domenet e zbuluara vetë, adresa e përkohshme, tuneli), instalimi (versioni, repo, kanali, folderët, databaza, portat) dhe cilësimet/sekretet (`.env`, token-at) me *Shfaq* dhe *Kopjo*; të fshehura derisa t'i shfaqësh.
- **Veprime:** përditësimi i aplikacionit (aktiv vetëm kur ka version të ri), **Rikthe një version** (kodi, formularët, dizajni; me butonin "Rikthe + databazën" kthehet edhe databaza nga backup-i i atij versioni: nga versionet që janë në këtë PC, pa shkarkim, ose nga GitHub; pas rikthimit versioni **ngjitet**: përditësimi automatik dhe njoftimi injorojnë versionet deri te ai që kishte GitHub, derisa del një më i ri ose shtypet "Hiq ngjitjen"), **Automatik në natë**, **Nisja me Windows**, Backup tani, SQL, import, token GitHub, tuneli Cloudflare, /developer, Stop/Start/Restart.
- **Backup-et:** lista me **versionin e programit** që punonte kur u bë (shkarko, **rikthe**, hap, fshi; rikthimi bën para një backup të gjendjes së tanishme), **Ku është instaluar**, **Log-u**.
- **Si ta përdorësh:** udhëzues në **Shqip** (parazgjedhja), **English** dhe **Srpski** (zgjedhja ruhet).
- **Cilësimet** (ingranazhi lart djathtas, në çdo faqe): **gjuha e gjithë dashboard-it** (Shqip / English / Srpski; edhe udhëzuesi), tema **Sistemi / Drita / Errët**, madhësia e shkrimit (3 nivele), kontrast i lartë, pa animacione (respektohet edhe cilësimi i Windows), shkrim i lexueshëm (jo monospace), lidhje me nënvizim, rivendos. Përkthimi bëhet nga një fjalor në `index.html` (`TR_LIST`); tekstet që vijnë nga serveri dhe nuk janë në fjalor mbeten shqip. Vetë faqja ka lidhje "kalo te përmbajtja", fokus të dukshëm, rolet ARIA (njoftimet, shiritat e progresit, dialogu me kurth fokusi dhe Esc) dhe gjuhën e dokumentit.

## Çfarë bën
- **Shëndeti dhe shpejtësia** nga `/api/health` i aplikacionit; **versioni i instaluar** kundrejt `stable`/`test` të repo-s së programit (versioni më i ri, ose build i ri me të njëjtin numër).
- **Domenet:** i mëson vetë (aplikacioni kujton adresën e kërkesës së fundit nga tuneli, pyetet çdo 15 s), i tregon me "hapet / nuk hapet" dhe i harron kur nuk hapen më (ose pas 14 ditësh). Nuk shkruhen me dorë.
- **Tuneli Cloudflare:** *Shto / Ndrysho tunelin* (token), *Hiq*; statusi "aktiv" vetëm kur procesi punon dhe të paktën një adresë hapet. **Adresa e përkohshme** (`trycloudflare.com`) krijohet me një buton, pa llogari.
- **Backup:** `mysqldump` (me `--hex-blob`) te `<të dhënat>\Backups`, emri **`Emri-Data-Ora.sql`** (emri = emri i databazës). Vetëm databaza.
- **Automatik në natë:** një orar i përbashkët (ora, sa backup të mbahen) me dy çelësa të pavarur: *Backup i databazës* dhe *Përditëso programin*. Nëse ka version të ri dhe përditësimi është i ndezur, përditësimi bëhet (ai fillon me backup: një backup, jo dy); përndryshe bëhet backup. Fshihen vetëm backup-et që i ka bërë ky orar.
- **Nisja me Windows:** çelës për *Aplikacioni + databaza* (një i vetëm), *Dashboard-i*, *Tuneli*; plus "Aktivizo / Ndalo të gjitha". Ato që punojnë nuk ndalen.
- **Përditësimi i aplikacionit:** `updater.ps1` (backup, build, migrimet, kontroll, kthim vetë te i vjetri), me **shirit progresi**. Dashboard-i nuk ndalet gjatë përditësimit.
- **Ekzekuto SQL** dhe **Importo databazën** (pas backup-it automatik); **/developer** hapet i zhbllokuar (dashboard-i dërgon SETUP_TOKEN te aplikacioni).

## Përditësimi i dashboard-it
Vetë. Repoja e tij publike është `rogestshalaa/HRSystem-Dashboard` (skedarët në rrënjë; `root/` mban skriptet PowerShell të instalimit). Çdo 10 minuta krahason skedarët me hash-in git, shkarkon ata që ndryshojnë, i ruan të vjetrit te `manager\.previous`, kontrollon `server.mjs` dhe rinisët; një roje e rikthen versionin e vjetër nëse i riu nuk përgjigjet brenda 25 s. Nuk ka buton: nuk duhet bërë asgjë me dorë. Pas përditësimit faqja e hapur rifreskohet **një herë** vetë (versioni i faqes vjen me pulsin LIVE; një mbrojtje nuk lejon cikël). Vetëm për dashboard-in e instaluar.

## Instalime të tjera
Opsionale: `instances.json` (kopje e `instances.example.json`, nuk shkon në GitHub) me fushat `id`, `name`, `url`, `repo`, `channel`, `root`, `data`, `task`. Pa të, gjendet vetë instalimi mbi `manager/`.

## Siguria
Hapet **pa çelës** (vendim i pronarit): dëgjon vetëm te `127.0.0.1`, refuzon çdo `Host` tjetër, dhe çdo veprim që ndryshon diçka kërkon çelësin e sesionit të faqes (rifreskohet vetë pas rinisjes). Nëse kompjuteri ka disa përdorues, krijo `manager/dashboard.key` (ose `DASHBOARD_KEY`) dhe hyrja kërkon fjalëkalim. Skedarët që fshihen, shkarkohen ose hapen merren vetëm nga lista e brendshme (asnjë rrugë nuk vjen nga përdoruesi). Tokenat ruhen të enkriptuar me DPAPI (`github.token`).
