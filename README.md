# HRSystem Dashboard

Program i vogël që hapet vetëm në PC-në tënde (`http://127.0.0.1:<port>`, nuk del në internet) dhe menaxhon **instalimin që punon në këtë PC** (folderi mbi `manager/`, p.sh. `C:\HRSystem` ose `D:\Regina`). Hapet me `Dashboard.bat`. Faqja është **LIVE**: një lidhje Server-Sent Events sjell çdo 3 sekonda shëndetin, shpejtësinë dhe progresin e punëve; faqja nuk rivizatohet nëse nuk ka ndryshuar diçka.

## Faqet
- **Pasqyra:** gjendja e aplikacionit (online, ms, grafik), databaza, versioni, adresa; njoftim kur ka version të ri dhe rezultati i punës së fundit.
- **Të dhënat:** adresat (lokale, domenet e zbuluara vetë, adresa e përkohshme, tuneli), instalimi (versioni, repo, kanali, folderët, databaza, portat) dhe cilësimet/sekretet (`.env`, token-at) me *Shfaq* dhe *Kopjo*; të fshehura derisa t'i shfaqësh.
- **Veprime:** përditësimi i aplikacionit (aktiv vetëm kur ka version të ri), **Rikthe një version** (kodi, formularët, dizajni; me butonin "Rikthe + databazën" kthehet edhe databaza nga backup-i i atij versioni: nga versionet që janë në këtë PC, pa shkarkim, ose nga GitHub; pas rikthimit versioni **ngjitet**: përditësimi automatik dhe njoftimi injorojnë versionet deri te ai që kishte GitHub, derisa del një më i ri ose shtypet "Hiq ngjitjen"), **Automatik**, **Nisja me Windows**, Backup tani, SQL, import, token GitHub, tuneli Cloudflare, /developer, Stop/Start/Restart.
- **Backup-et:** lista me **versionin e programit** që punonte kur u bë (shkarko, **rikthe**, hap, fshi; rikthimi bën para një backup të gjendjes së tanishme), **Ku është instaluar**, **Log-u**.
- **Si ta përdorësh:** udhëzues në **Shqip** (parazgjedhja), **English** dhe **Srpski** (zgjedhja ruhet).
- **Cilësimet** (ingranazhi lart djathtas, në çdo faqe): **gjuha e gjithë dashboard-it** (Shqip / English / Srpski; edhe udhëzuesi), tema **Sistemi / Drita / Errët**, madhësia e shkrimit (3 nivele), kontrast i lartë, pa animacione (respektohet edhe cilësimi i Windows), shkrim i lexueshëm (jo monospace), lidhje me nënvizim, rivendos. Përkthimi bëhet nga një fjalor në `index.html` (`TR_LIST`); tekstet që vijnë nga serveri dhe nuk janë në fjalor mbeten shqip. Vetë faqja ka lidhje "kalo te përmbajtja", fokus të dukshëm, rolet ARIA (njoftimet, shiritat e progresit, dialogu me kurth fokusi dhe Esc) dhe gjuhën e dokumentit.

## Çfarë bën
- **Shëndeti dhe shpejtësia** nga `/api/health` i aplikacionit; **versioni i instaluar** kundrejt `stable`/`test` të repo-s së programit (versioni më i ri, ose build i ri me të njëjtin numër).
- **Adresat:** një listë e vetme (domenet që i mëson vetë aplikacioni dhe adresa e përkohshme `trycloudflare.com` janë njësoj adresa). Asnjë adresë nuk hiqet vetë, as kur nuk hapet: vetëm kur e heq ti me **Hiq**. Një buton, **Ndrysho tani**, zgjedh: adresë e përkohshme ose domeni yt me tunel Cloudflare (token). Adresa e përkohshme nis si proces i pavarur (WMI), ndaj mbijeton rindezjes dhe përditësimit të dashboard-it.
- **Tuneli Cloudflare:** *Shto / Ndrysho tunelin* (token), *Hiq tunelin* (te **Ndrysho tani**); statusi "aktiv" vetëm kur procesi punon dhe të paktën një adresë hapet.
- **Backup:** `mysqldump` (me `--hex-blob`) te `<të dhënat>\Backups`, emri **`Emri-Data-Ora.sql`** (emri = emri i databazës). Vetëm databaza.
- **Automatik:** një orar i përbashkët (ora, sa backup të mbahen) me dy çelësa të pavarur: *Backup i databazës* dhe *Përditëso programin*. Nëse ka version të ri dhe përditësimi është i ndezur, përditësimi bëhet (ai fillon me backup: një backup, jo dy); përndryshe bëhet backup. Fshihen vetëm backup-et që i ka bërë ky orar.
- **Nisja me Windows:** çelës për *Aplikacioni + databaza* (një i vetëm), *Dashboard-i*, *Tuneli*; plus "Aktivizo / Ndalo të gjitha". Ato që punojnë nuk ndalen.
- **Përditësimi i aplikacionit:** `updater.ps1` (backup, build, migrimet, kontroll, kthim vetë te i vjetri), me **shirit progresi**. Dashboard-i nuk ndalet gjatë përditësimit.
- **Ekzekuto SQL** dhe **Importo databazën** (pas backup-it automatik); **/developer** hapet i zhbllokuar (dashboard-i dërgon SETUP_TOKEN te aplikacioni).

## Përditësimi i dashboard-it
Vetë. Repoja e tij publike është `rogestshalaa/HRSystem-Dashboard` (skedarët në rrënjë; `root/` mban skriptet PowerShell të instalimit). Çdo 10 minuta krahason skedarët me hash-in git, shkarkon ata që ndryshojnë, i ruan të vjetrit te `manager\.previous`, kontrollon `server.mjs` dhe rinisët; një roje e rikthen versionin e vjetër nëse i riu nuk përgjigjet brenda 25 s. Nuk ka buton: nuk duhet bërë asgjë me dorë. Pas përditësimit faqja e hapur rifreskohet **një herë** vetë (versioni i faqes vjen me pulsin LIVE; një mbrojtje nuk lejon cikël). Vetëm për dashboard-in e instaluar.

## Instalime të tjera
Opsionale: `instances.json` (kopje e `instances.example.json`, nuk shkon në GitHub) me fushat `id`, `name`, `url`, `repo`, `channel`, `root`, `data`, `task`. Pa të, gjendet vetë instalimi mbi `manager/`.

## Siguria
Hapet **pa çelës** (vendim i pronarit): dëgjon vetëm te `127.0.0.1`, refuzon çdo `Host` tjetër, dhe çdo veprim që ndryshon diçka kërkon çelësin e sesionit të faqes (rifreskohet vetë pas rinisjes). Nëse kompjuteri ka disa përdorues, krijo `manager/dashboard.key` (ose `DASHBOARD_KEY`) dhe hyrja kërkon fjalëkalim. Skedarët që fshihen, shkarkohen ose hapen merren vetëm nga lista e brendshme (asnjë rrugë nuk vjen nga përdoruesi). Tokenat ruhen të enkriptuar me DPAPI (`github.token`).

## Veçoritë profesionale
- **Pasqyra:** hapësira që zë HR (programi, databaza, backup-et), CPU dhe RAM vetëm të sistemit HR (aplikacioni + databaza), sa kohë punon aplikacioni, backup-i i fundit me kontrollin OK / Dëmtuar. Kur aplikacioni është **Fikur** nuk matet çdo 3 sekonda (kontrollohet çdo 15 s).
- **Download / Upload (HR):** sa të dhëna lexon (download) dhe shkruan (upload) vetëm sistemi HR (aplikacioni + databaza): shpejtësia tani, totali i sotëm dhe që nga ndezja. Windows nuk e jep rrjetin e një programi të vetëm pa mjete shtesë, prandaj matet leximi/shkrimi i proceseve HR.
- **Njoftimet për ndalimin:** në telefon vjen çdo herë shkaku: *u ndal manualisht* (Stop), *u ndez manualisht* (Start), *u rindez manualisht* (Restart), *u mbyll vetë* (pa e ndalur ti, pas 1 minute), *u ndez vetë* (ndezja automatike). Fonti i dashboard-it është një sans-serif profesional; monospace vetëm për kodin dhe log-un.
- **Ndezja vetë kur bie:** nëse aplikacioni bie pa e ndalur ti (jo me butonin Stop) dhe "Nisja me Windows" për aplikacionin është e ndezur, dashboard-i e ndez përsëri pas 1 minute dhe të njofton (provon sërish më së shpeshti çdo 10 minuta). Pas Stop, ose kur ndezja automatike është e fikur, nuk ndizet vetë.
- **Historiku:** 200 veprimet e fundit (backup, përditësim, rikthim, probleme, kopje jashtë PC-së).
- **Kopje jashtë PC-së** (Veprime): çdo backup kopjohet automatikisht te një folder i zgjedhur (disk i jashtëm, rrjet, folder cloud); kontrollohet çdo 5 minuta.
- **Njoftime në telefon** (Veprime): ntfy.sh (emër teme) ose webhook; kur aplikacioni bie 1 minutë, backup/përditësim dështon, pak hapësirë, përditësim i kryer. Opsionale, fikur si parazgjedhje.
- **Qasja (Cilësimet → Shtesë):** hapësirë teksti sipas WCAG 1.4.12, butona dhe objekte 44 px (WCAG 2.5.8), ngjyra të sigurta për verbëri ngjyrash me simbole në çdo status (WCAG 1.4.1), fokus i fortë, mesazhe që qëndrojnë derisa i mbyll (WCAG 2.2.1), pauzë e përditësimit LIVE (WCAG 2.2.2) dhe shkrim deri në 150%. Mbështet edhe ngjyrat e detyruara të Windows.
- **Fjalëkalimi** (Cilësimet, ingranazhi): opsional; ruhet te `manager\dashboard.key`; harrova = fshi atë skedar.
- **Diagnostika** (faqja Log-u): një skedar .txt me gjendjen dhe fundin e log-eve, sekretet të fshehura.
- Kur dashboard-i rindizet, faqja e hapur rifreskohet vetë një herë (pa "forbidden").
