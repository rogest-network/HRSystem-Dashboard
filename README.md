# HRSystem Dashboard

Program i vogël që hapet vetëm në PC-në tënde (`http://127.0.0.1:<port>`, nuk del në internet) dhe menaxhon **instalimin që punon në këtë PC** (folderi mbi `manager/`, p.sh. `C:\HRSystem` ose `D:\Regina`). Hapet me `Dashboard.bat`. Faqja është **LIVE**: një lidhje Server-Sent Events sjell çdo 3 sekonda shëndetin, shpejtësinë dhe progresin e punëve; faqja nuk rivizatohet nëse nuk ka ndryshuar diçka.

## Faqet
- **Pasqyra:** gjendja e aplikacionit (online, ms, grafik), databaza, versioni, adresa; njoftim kur ka version të ri dhe rezultati i punës së fundit.
- **Të dhënat:** adresat (lokale, domenet e zbuluara vetë, adresa e përkohshme, tuneli), instalimi (versioni, repo, kanali, folderët, databaza, portat) dhe cilësimet/sekretet (`.env`, token-at) me *Shfaq* dhe *Kopjo*; të fshehura derisa t'i shfaqësh.
- **Veprime:** përditësimi i aplikacionit (aktiv vetëm kur ka version të ri), **Rikthe një version** (kodi, formularët, dizajni; me butonin "Rikthe + databazën" kthehet edhe databaza nga backup-i i atij versioni: nga versionet që janë në këtë PC, pa shkarkim, ose nga GitHub; pas rikthimit versioni **ngjitet**: përditësimi automatik dhe njoftimi injorojnë versionet deri te ai që kishte GitHub, derisa del një më i ri ose shtypet "Hiq ngjitjen"), **Automatik**, **Nisja me Windows**, Backup tani, SQL, import, token GitHub, tuneli Cloudflare, /developer, Stop/Start/Restart.
- **Backup-et:** lista me **versionin e programit** që punonte kur u bë (shkarko, **rikthe**, hap, fshi; rikthimi bën para një backup të gjendjes së tanishme), **Ku është instaluar**, **Log-u**.
- **Gabimet e raportuara** (v1.8.0): raportet që punonjësit dërgojnë nga aplikacioni (Profili → Rreth Aplikacionit → Raporto një gabim) me emrin, rolin, pikën, faqen, telefonin dhe versionin. Katër skeda: **Të raportuara**, **Në përpunim**, **Të zgjidhura** dhe **Roadmap**; çdo raport kalon nga njëra te tjetra me një buton ("Kalo në roadmap" kur do ta bësh më vonë). Dashboard-i i lexon raportet vetëm nga databaza e këtij PC-je (pa i ndryshuar); zgjedhjet e tua ruhen te dashboard-i. Vjen njoftim në telefon për raport të ri (ndahet me çelës te Njoftimet) dhe një numër i kuq te menuja.
- **Si ta përdorësh:** udhëzues në **Shqip** (parazgjedhja), **English** dhe **Srpski** (zgjedhja ruhet). Që nga v1.8.1 mbulon çdo faqe të menusë (Kryesore me veprimet e shpejta dhe të fundit, Vendndodhja, Gabimet, Gabimet e raportuara, Çfarë ka të re), programet e sistemit me dy hapat (Shkarko, pastaj Instalo tani ose Cakto kohën, edhe automatik), Eksporto SQL, zonën e rrezikut dhe njoftimet për raportet e gabimeve.
- **Cilësimet** (një faqe më vete, e hapur vetëm nga ikona e ingranazhit mbi "Krijuar nga Rogest Network" në menu; pesë karta: Gjuha, Pamja, Siguria, Qasja, Shtesë të qasjes; çdo zgjedhje vlen menjëherë): **gjuha e gjithë dashboard-it** (Shqip / English / Srpski; edhe udhëzuesi), tema **Sistemi / Drita / Errët**, madhësia e shkrimit (3 nivele), kontrast i lartë, pa animacione (respektohet edhe cilësimi i Windows), shkrim i lexueshëm (jo monospace), lidhje me nënvizim, rivendos. Përkthimi bëhet nga një fjalor në `index.html` (`TR_LIST`); tekstet që vijnë nga serveri dhe nuk janë në fjalor mbeten shqip. Vetë faqja ka lidhje "kalo te përmbajtja", fokus të dukshëm, rolet ARIA (njoftimet, shiritat e progresit, dialogu me kurth fokusi dhe Esc) dhe gjuhën e dokumentit.

## Çfarë bën
- **Shëndeti dhe shpejtësia** nga `/api/health` i aplikacionit; **versioni i instaluar** kundrejt `stable`/`test` të repo-s së programit (versioni më i ri, ose build i ri me të njëjtin numër).
- **Adresat:** një listë e vetme (domenet që i mëson vetë aplikacioni dhe adresa e përkohshme `trycloudflare.com` janë njësoj adresa). Asnjë adresë nuk hiqet vetë, as kur nuk hapet: vetëm kur e heq ti me **Hiq**. Një buton, **Ndrysho tani**, zgjedh: adresë e përkohshme ose domeni yt me tunel Cloudflare (token). Adresa e përkohshme nis si proces i pavarur dhe i fshehur (WMI, pa dritare konsole: nuk mbyllet aksidentalisht), ndaj mbijeton rindezjes dhe përditësimit të dashboard-it. Nëse krijimi dështon, provohet përsëri me pauzë që dyfishohet (1, 2, 4 ... deri 15 minuta), jo çdo 20 sekonda. Cloudflare jep një adresë të rastësishme sa herë nis tuneli, ndaj një adresë e përkohshme nuk mund të mbahet e njëjtë pasi tuneli ndalet (rindezja e kompjuterit); atëherë dashboard-i bën një të re dhe të njofton në telefon me adresën e re. Adresë e qëndrueshme ka vetëm me domenin tënd (tunel i emëruar).
- **Tuneli Cloudflare:** *Shto / Ndrysho tunelin* (token), *Hiq tunelin* (te **Ndrysho tani**); statusi "aktiv" vetëm kur procesi punon dhe të paktën një adresë hapet.
- **Backup:** `mysqldump` (me `--hex-blob`) te `<të dhënat>\Backups`, emri **`Emri-Data-Ora.sql`** (emri = emri i databazës). Vetëm databaza.
- **Automatik:** një orar i përbashkët (ora, sa backup të mbahen) me dy çelësa të pavarur: *Backup i databazës* dhe *Përditëso programin*. Nëse ka version të ri dhe përditësimi është i ndezur, përditësimi bëhet (ai fillon me backup: një backup, jo dy); përndryshe bëhet backup. Fshihen vetëm backup-et që i ka bërë ky orar.
- **Nisja me Windows:** çelës për *Aplikacioni + databaza* (një i vetëm), *Dashboard-i*, *Tuneli*; plus "Aktivizo / Ndalo të gjitha". Ato që punojnë nuk ndalen.
- **Përditësimi i aplikacionit:** `updater.ps1` (backup, build, migrimet, kontroll, kthim vetë te i vjetri), me **shirit progresi**. Dashboard-i nuk ndalet gjatë përditësimit.
- **Ekzekuto SQL** dhe **Importo databazën** (pas backup-it automatik); **/developer** hapet i zhbllokuar (dashboard-i dërgon SETUP_TOKEN te aplikacioni).

## Përditësimi i dashboard-it
Vetë. Repoja e tij publike është `rogest-network/HRSystem-Dashboard` (vetëm dashboard-i; skriptet e instalimit nuk janë aty). Çdo minutë shikon commit-in e fundit dhe, kur ka të ri, krahason skedarët me hash-in git, shkarkon ata që ndryshojnë, i ruan të vjetrit te `manager\.previous`, kontrollon `server.mjs` dhe rinisët; një roje e rikthen versionin e vjetër nëse i riu nuk përgjigjet brenda 25 s. Nuk ka buton: nuk duhet bërë asgjë me dorë. Pas përditësimit faqja e hapur rifreskohet **një herë** vetë (versioni i faqes vjen me pulsin LIVE; një mbrojtje nuk lejon cikël). Vetëm për dashboard-in e instaluar.

## Instalime të tjera
Opsionale: `instances.json` (kopje e `instances.example.json`, nuk shkon në GitHub) me fushat `id`, `name`, `url`, `repo`, `channel`, `root`, `data`, `task`. Pa të, gjendet vetë instalimi mbi `manager/`.

## Siguria
Hapet **pa çelës** (vendim i pronarit): dëgjon vetëm te `127.0.0.1`, refuzon çdo `Host` tjetër, dhe çdo veprim që ndryshon diçka kërkon çelësin e sesionit të faqes (rifreskohet vetë pas rinisjes). Nëse kompjuteri ka disa përdorues, krijo `manager/dashboard.key` (ose `DASHBOARD_KEY`) dhe hyrja kërkon fjalëkalim. Skedarët që fshihen, shkarkohen ose hapen merren vetëm nga lista e brendshme (asnjë rrugë nuk vjen nga përdoruesi). Tokenat ruhen të enkriptuar me DPAPI (`github.token`).

## Veçoritë profesionale
- **Pasqyra:** hapësira që zë HR (programi, databaza, backup-et), CPU dhe RAM vetëm të sistemit HR (aplikacioni + databaza), sa kohë punon aplikacioni, backup-i i fundit me kontrollin OK / Dëmtuar. Kur aplikacioni është **Fikur** nuk matet çdo 3 sekonda (kontrollohet çdo 15 s).
- **Download / Upload (HR):** sa të dhëna lexon (download) dhe shkruan (upload) vetëm sistemi HR (aplikacioni + databaza): shpejtësia tani, totali i sotëm dhe që nga ndezja. Windows nuk e jep rrjetin e një programi të vetëm pa mjete shtesë, prandaj matet leximi/shkrimi i proceseve HR.
- **Repo-ja ndjek tokenin:** kur ruan një token GitHub (ose çdo 10 minuta), nëse tokeni lexon saktësisht një repo tjetër nga ajo e instalimit, instalimi e ndjek atë dhe emri në menu ndryshon vetë (repo i dashboard-it nuk llogaritet). Nëse tokeni sheh disa repo, mbetet repo aktual dhe të tregohen zgjedhjet.
- **Njoftimet për ndalimin:** në telefon vjen çdo herë shkaku: *u ndal manualisht* (Stop), *u ndez manualisht* (Start), *u rindez manualisht* (Restart), *u mbyll vetë* (pa e ndalur ti, pas 1 minute), *u ndez vetë* (ndezja automatike). Fonti i dashboard-it është një sans-serif profesional; monospace vetëm për kodin dhe log-un.
- **Ndezja vetë kur bie:** nëse aplikacioni bie pa e ndalur ti (jo me butonin Stop) dhe "Nisja me Windows" për aplikacionin është e ndezur, dashboard-i e ndez përsëri pas 1 minute dhe të njofton (provon sërish më së shpeshti çdo 10 minuta). Pas Stop, ose kur ndezja automatike është e fikur, nuk ndizet vetë.
- **Historiku:** 200 veprimet e fundit (backup, përditësim, rikthim, probleme, kopje jashtë PC-së).
- **Kopje jashtë PC-së** (Veprime): çdo backup kopjohet automatikisht te një folder i zgjedhur (disk i jashtëm, rrjet, folder cloud); kontrollohet çdo 5 minuta.
- **Njoftime në telefon** (Veprime): ntfy.sh (emër teme) ose webhook; kur aplikacioni bie 1 minutë, backup/përditësim dështon, pak hapësirë, përditësim i kryer. Opsionale, fikur si parazgjedhje.
- **Qasja (Cilësimet → Shtesë):** hapësirë teksti sipas WCAG 1.4.12, butona dhe objekte 44 px (WCAG 2.5.8), ngjyra të sigurta për verbëri ngjyrash me simbole në çdo status (WCAG 1.4.1), fokus i fortë, mesazhe që qëndrojnë derisa i mbyll (WCAG 2.2.1), pauzë e përditësimit LIVE (WCAG 2.2.2) dhe shkrim deri në 150%. Mbështet edhe ngjyrat e detyruara të Windows.
- **Fjalëkalimi** (Cilësimet → Siguria): opsional. Shkruhet vetëm **një herë** (me *Shfaq* për ta parë). Kur është aktiv, shfaqet i fshehur dhe *Shfaq* e tregon; hyrja vlen vetëm sa është hapur shfletuesi (kur mbyllet dashboard-i dhe hapet përsëri, kërkon fjalëkalimin); *Dil nga dashboard-i* e mbyll hyrjen. Për ta ndryshuar duhen i aktuali dhe i riu; **Hiq fjalëkalimin** është buton më vete (kërkon të aktualin). 5 gabime në minutë e kyçin një minutë. Ruhet te `manager\dashboard.key`; harrova = fshi atë skedar.
- **Diagnostika** (faqja Log-u): një skedar .txt me gjendjen dhe fundin e log-eve, sekretet të fshehura.
- Kur dashboard-i rindizet, faqja e hapur rifreskohet vetë një herë (pa "forbidden").
- **Gabimet** (faqja Gabimet, numri i gabimeve të 24 orëve në menu): gabimet e dashboard-it (`dashboard-errors.log`, mbahen ~1500 të fundit), me log-un e aplikacionit, të përditësimit dhe të dashboard-it; filtër, shkarkim, pastrim. Diagnostika i përfshin 20 të fundit.
- **Vendndodhja e serverit** (faqja Të dhënat): shteti, qendra Cloudflare, IP publike dhe emri i kompjuterit.
- **Alarme:** backup i vjetër (mbi 36 orë), adresa publike nuk hapet / u kthye, dhe **raporti i ditës** (një përmbledhje në telefon, ora e zgjedhur (parazgjedhje 08:00); ndizet/fiket te njoftimet).
- **Testo backup-in** (faqja Backup-et): kontrollon strukturën e kopjes (tabelat, përdoruesit) pa e prekur databazën; backup-i shënohet "I provuar".
- **Pamja:** ekran hyrjeje (loading), fusha dhe paralajmërime më të pastra, rrotullues në butonat që punojnë, animacione të shkurtra (fiken me 'Pa animacione'), header i ngjeshur me skeda në telefon.
- **Adresa e dashboard-it:** është e fiksuar te `http://127.0.0.1:3500` (nuk ndryshon më pas rinisjes; vetëm nëse 3500 është e zënë, merr 3501...).
- **Njoftime për përditësime:** vjen mesazh kur del një version i ri i programit (një herë për version), kur përditësimi mbaron, dhe kur vetë dashboard-i përditësohet.
- **Njoftimet:** çdo njoftim ka nivel (info, sukses, kujdes, gabim), titull dhe tekst të qartë.

> Për Claude/zhvillues: shih `ARCHITECTURE.md` (si është ndërtuar, rregullat e ndryshimit, testimi).

- **Release notes:** the text of a new Release goes to the phone message "Ka version të ri" (the page "Çfarë ka të re" was removed from the dashboard in v1.8.2).

- **Dashboard version:** v2.0.1 (checks for its own new version every minute) (look "Premium" by default, "Klasike" = the 1.9.1 glass look, in Settings; "LIVE • v<version>" in the sidebar foot); after each self-update the phone gets what is new (DASH_NOTES). There is no "Çfarë ka të re" page any more.

- **v1.2.0:** JetBrains Mono, icon cards, one set of status colours, "Kryesore" and a Ctrl+K search.

- **v1.3.0:** the HRSystem logo (menu, loading screen, sign-in, favicon), the search in the page header, and a richer Kryesore (quick actions, fuller Databaza and Lidhja cards).

- **v1.4.0:** choose which kinds of phone notifications arrive (app, addresses, backups, disk, updates, daily report; `notify.events`), Export SQL, a "Kontakto Administratorin" card in Settings, and shorter texts (no "tani" on buttons).

- **v1.4.1:** an update shows how it was done: automatically (the night job) or manually (a button), in Historiku, Veprimet e fundit, Log and the phone message.

- **v1.4.2:** Settings is a wide button under the logo; Uninstall is at the bottom of Veprime and asks twice.

- **v1.5.0:** a full UI redesign (design system block at the end of the stylesheet): Inter, navy menu (#0B1220), purple actions (#5546F0), one button/field/card style, a collapsible menu, a version accordion (newest open, older collapsed), a folder card for the off-PC copy (full path, status, change / disconnect / reconnect / remove, guidance on errors), routine actions separated from recovery and the danger zone, log levels with colour and a word. The "new version" banner on Kryesore is short and has a button to the page "Cfare ka te re".

- **v1.5.1:** the dashboard reads its updates from the new GitHub name `rogest-network` (the old name still redirects).

- **v1.6.0:** Veprime has a card "Programet e sistemit": the versions of Node.js and cloudflared (from this PC) against the newest (nodejs.org, GitHub), and an update button for each (asks twice, runs as an action, steps in Log-u). Node.js moves only inside the same major version, its installer is checked with SHA-256; cloudflared is updated with winget (its Windows service is stopped and started around it). Log lines are translated to the chosen language.

- **v1.7.5:** the night job keeps the newest N backups of the folder (N = "Sa backup të mbahen", e.g. 7) whoever made them (night job, updater or button); before, only the night job's own backups were counted, so manual or updater ones made the folder grow past N.
- **v1.7.4:** the red lamp (Aplikacioni "Fikur", Lidhja "Nuk hapet") no longer turns on for one slow answer: the live pulse asks the application again with a longer wait (2.5 s then 8 s) and the addresses are asked again (5 s then 10 s); a red address is checked again after 15 s instead of 45 s. A refused connection is still down at once.
- **v1.7.3:** program update no longer fails on npm warnings (the dashboard sets npm_config_loglevel=error for the updater; updater.ps1 itself now ignores stderr text and checks exit codes).
- **v1.7.2:** the menu shows the dashboard version below LIVE.
- **v1.7.1:** Node.js install fix. The installer closes every node.exe, so the dashboard (a Node program) became unreachable and the application was not started again. Now a separate script (started through `cmd /c start`) installs, starts the application and starts the dashboard again if it is gone; the dashboard reports the result when it is back. Cloudflared was fine (tested by the owner: it worked).
- **v1.7.0:** "Programet e sistemit" in two steps: Shkarko (the installer is downloaded into tools-staging and checked with SHA-256) and the installation, now or at a time the owner sets (default shown: the next 02:00). Automatic: download of new versions by itself (on by default) and installation by itself at the hour the owner chooses (off by default). Setup now installs the newest Node.js of the major the system is tested with (24.x, SHA-256 checked).
