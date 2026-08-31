# Testlog — bilbooking

**Kørt:** 2026-08-31T20:29:28.843Z
**Miljø:** GitHub Actions (Node v20.20.2, TZ=Europe/Copenhagen)

## Sammendrag

- **Tests i alt:** 696
- ✅ **Bestået:** 696
- ❌ **Fejlet:** 0
- 🔎 **Observationer (findings):** 6

### ❌ Fejlede tests

_Ingen fejlede tests._

### 🔎 Observationer & anbefalinger

- **[Priser — tid] Tidspris er IKKE monotont stigende**
  - Ved 1439 min koster det 359.75 kr., men ved 1440 min kun 150.00 kr. En længere booking bliver altså billigere. Sker fordi 24 t afregnes som 1 døgn (150 kr.), mens 23 t afregnes som 23×15=345 kr. Overvej at tage min(døgn, timer×sats) pr. påbegyndt døgn.
- **[Priser — tid] 23 timer dyrere end 24 timer**
  - 23t=345.00 kr. vs 24t=150.00 kr.
- **[Priser — tid] 47 timer dyrere end 48 timer**
  - 47t=495.00 kr. vs 48t=300.00 kr.
- **[Backend — settings & sikkerhed] admin_password er læsbar med den offentlige nøgle**
  - SELECT-politikken tillader anon at læse alle settings, inkl. admin_password-hash/-værdi. Overvej at flytte admin-login til en Edge Function eller begrænse SELECT på den nøgle.
- **[Backend — overlap & samtidighed] Ingen DB-constraint mod dobbeltbooking (race condition)**
  - To overlappende bookinger indsat samtidigt lykkedes begge. createBooking/updateBooking laver kun et forhåndstjek i JS før INSERT — mellem tjek og INSERT kan en anden bruger nå at booke samme bil. Anbefaling: tilføj en PostgreSQL EXCLUDE-constraint (btree_gist) på (car_id WITH =, tsrange(start,end) WITH &&) hvor status=active, så databasen selv afviser overlap.
- **[Backend — settings & sikkerhed] settings-tabellen har ingen DELETE-politik (tavs no-op)**
  - En DELETE mod `settings` med den offentlige nøgle returnerer HTTP 200, men fjerner 0 rækker (RLS uden DELETE-politik afviser sletningen, mens PostgREST alligevel svarer 200). Sikkerhedsmæssigt fint, men betyder at nøgler oprettet med den offentlige nøgle ikke kan ryddes op igen via API'et. Testsuiten er efterfølgende rettet til ikke at oprette nye nøgler.

## Oprydning af testdata

- Slettede rækker: bookinger 5, medlemmer 5, leveringer 1
- Efterladt testdata: medlemmer 0 ✅, bookinger 0 ✅ (46 bookinger = uændret ift. før test)
- ⚠️ **Én udestående oprydning:** testnøglen `zz_selftest_ZZTEST_1788208168843` (værdi `"2"`) i settings kunne IKKE slettes med den offentlige nøgle (se observation om manglende DELETE-politik). Den er harmløs (ukendt nøgle som hverken app eller backup læser), men fjernes helt ved at køre denne linje i Supabase → SQL Editor:
  ```sql
  DELETE FROM settings WHERE key LIKE 'zz_selftest_%';
  ```

## Detaljeret log (grupperet efter type)

### Backend — DB-constraints

6 bestået · 0 fejlet · 0 observation(er) — 6 linjer

- ✅ `T0688` afviser slut før start (no_end_before_start)
- ✅ `T0689` afviser slut = start
- ✅ `T0690` afviser ugyldig status-værdi
- ✅ `T0691` afviser manglende user_name (NOT NULL)
- ✅ `T0692` afviser ukendt car_id (fremmednøgle)
- ✅ `T0693` afviser levering med end_km < start_km (positive_km)

### Backend — bookinger (CRUD)

7 bestået · 0 fejlet · 0 observation(er) — 7 linjer

- ✅ `T0679` opret gyldig booking
- ✅ `T0680` ny booking har status=active
- ✅ `T0681` kan læse booking tilbage
- ✅ `T0682` expected_km gemt
- ✅ `T0683` opdatér bookingtider
- ✅ `T0684` annullér booking (status=cancelled)
- ✅ `T0685` personal_note-kolonnen findes og kan skrives

### Backend — forbindelse & læsning

5 bestået · 0 fejlet · 0 observation(er) — 5 linjer

- ✅ `T0664` kan læse cars-tabellen (HTTP 200)
- ✅ `T0665` mindst én bil findes
- ✅ `T0666` kan læse settings-tabellen
- ✅ `T0667` kan læse members-tabellen
- ✅ `T0668` kan læse bookings-tabellen

### Backend — leveringer

2 bestået · 0 fejlet · 0 observation(er) — 2 linjer

- ✅ `T0686` opret levering
- ✅ `T0687` km_driven beregnes (75)

### Backend — medlemmer (CRUD)

10 bestået · 0 fejlet · 0 observation(er) — 10 linjer

- ✅ `T0669` opret medlem Alice
- ✅ `T0670` opret medlem Bob
- ✅ `T0671` opret medlem Citra
- ✅ `T0672` opret medlem Dan
- ✅ `T0673` opret medlem Eva
- ✅ `T0674` læs egne testmedlemmer tilbage
- ✅ `T0675` nye medlemmer er aktive som standard
- ✅ `T0676` opdatér medlems telefon
- ✅ `T0677` opdatering gemt korrekt
- ✅ `T0678` kan deaktivere medlem

### Backend — overlap & samtidighed

2 bestået · 0 fejlet · 1 observation(er) — 3 linjer

- ✅ `T0699` app-forhåndstjek opdager overlap
- ✅ `T0700` anden bil overlapper ikke i forhåndstjek
- 🔎 `T0701` Ingen DB-constraint mod dobbeltbooking (race condition) — To overlappende bookinger indsat samtidigt lykkedes begge. createBooking/updateBooking laver kun et forhåndstjek i JS før INSERT — mellem tjek og INSERT kan en anden bruger nå at booke samme bil. Anbefaling: tilføj en PostgreSQL EXCLUDE-constraint (btree_gist) på (car_id WITH =, tsrange(start,end) WITH &&) hvor status=active, så databasen selv afviser overlap.

### Backend — settings & sikkerhed

4 bestået · 0 fejlet · 1 observation(er) — 5 linjer

- ✅ `T0694` blokerer INSERT af admin_password
- ✅ `T0695` blokerer UPDATE af admin_password
- ✅ `T0696` kan indsætte almindelig indstilling
- ✅ `T0697` kan opdatere almindelig indstilling
- 🔎 `T0698` admin_password er læsbar med den offentlige nøgle — SELECT-politikken tillader anon at læse alle settings, inkl. admin_password-hash/-værdi. Overvej at flytte admin-login til en Edge Function eller begrænse SELECT på den nøgle.

### Bilkategori (el vs. standard)

12 bestået · 0 fejlet · 0 observation(er) — 12 linjer

- ✅ `T0001` kategori("ID3") = standard
- ✅ `T0002` kategori("Berlingo") = standard
- ✅ `T0003` kategori("Renault Zoe") = electric
- ✅ `T0004` kategori("ID Buzz") = electric
- ✅ `T0005` kategori("zoe") = electric
- ✅ `T0006` kategori("BUZZ") = electric
- ✅ `T0007` kategori("id buzz") = electric
- ✅ `T0008` kategori("Skoda") = standard
- ✅ `T0009` kategori("") = standard
- ✅ `T0010` kategori("Zoe elbil") = electric
- ✅ `T0011` kategori("Buzz Cargo") = electric
- ✅ `T0012` kategori("Berlingo Van") = standard

### Dato — ISO-ugenummer

7 bestået · 0 fejlet · 0 observation(er) — 7 linjer

- ✅ `T0462` ISO-uge 2020-12-31 = 53
- ✅ `T0463` ISO-uge 2021-01-04 = 1
- ✅ `T0464` ISO-uge 2023-01-01 = 52
- ✅ `T0465` ISO-uge 2024-12-30 = 1
- ✅ `T0466` ISO-uge 2026-01-01 = 1
- ✅ `T0467` ISO-uge 2026-08-31 = 36
- ✅ `T0468` getISOWeek matcher reference-algoritme over 2022–2027

### Dato — addDays

5 bestået · 0 fejlet · 0 observation(er) — 5 linjer

- ✅ `T0659` addDays +1 over månedsskifte
- ✅ `T0660` addDays +1 over månedsskifte (dag)
- ✅ `T0661` addDays -1 over årsskifte (år)
- ✅ `T0662` addDays +365 (skudår 2028 → 366)
- ✅ `T0663` addDays ændrer ikke original

### Dato — getMonday

84 bestået · 0 fejlet · 0 observation(er) — 84 linjer

- ✅ `T0378` getMonday(Thu Jan 01 2026) er mandag
- ✅ `T0379` getMonday(Thu Jan 01 2026) ikke efter input
- ✅ `T0380` getMonday(Thu Jan 01 2026) inden for 7 dage
- ✅ `T0381` getMonday(Thu Jan 01 2026) nulstiller klokkeslæt
- ✅ `T0382` getMonday(Fri Jan 02 2026) er mandag
- ✅ `T0383` getMonday(Fri Jan 02 2026) ikke efter input
- ✅ `T0384` getMonday(Fri Jan 02 2026) inden for 7 dage
- ✅ `T0385` getMonday(Fri Jan 02 2026) nulstiller klokkeslæt
- ✅ `T0386` getMonday(Sat Jan 03 2026) er mandag
- ✅ `T0387` getMonday(Sat Jan 03 2026) ikke efter input
- ✅ `T0388` getMonday(Sat Jan 03 2026) inden for 7 dage
- ✅ `T0389` getMonday(Sat Jan 03 2026) nulstiller klokkeslæt
- ✅ `T0390` getMonday(Sun Jan 04 2026) er mandag
- ✅ `T0391` getMonday(Sun Jan 04 2026) ikke efter input
- ✅ `T0392` getMonday(Sun Jan 04 2026) inden for 7 dage
- ✅ `T0393` getMonday(Sun Jan 04 2026) nulstiller klokkeslæt
- ✅ `T0394` getMonday(Mon Jan 05 2026) er mandag
- ✅ `T0395` getMonday(Mon Jan 05 2026) ikke efter input
- ✅ `T0396` getMonday(Mon Jan 05 2026) inden for 7 dage
- ✅ `T0397` getMonday(Mon Jan 05 2026) nulstiller klokkeslæt
- ✅ `T0398` getMonday(Tue Jan 06 2026) er mandag
- ✅ `T0399` getMonday(Tue Jan 06 2026) ikke efter input
- ✅ `T0400` getMonday(Tue Jan 06 2026) inden for 7 dage
- ✅ `T0401` getMonday(Tue Jan 06 2026) nulstiller klokkeslæt
- ✅ `T0402` getMonday(Wed Jan 07 2026) er mandag
- ✅ `T0403` getMonday(Wed Jan 07 2026) ikke efter input
- ✅ `T0404` getMonday(Wed Jan 07 2026) inden for 7 dage
- ✅ `T0405` getMonday(Wed Jan 07 2026) nulstiller klokkeslæt
- ✅ `T0406` getMonday(Thu Jan 08 2026) er mandag
- ✅ `T0407` getMonday(Thu Jan 08 2026) ikke efter input
- ✅ `T0408` getMonday(Thu Jan 08 2026) inden for 7 dage
- ✅ `T0409` getMonday(Thu Jan 08 2026) nulstiller klokkeslæt
- ✅ `T0410` getMonday(Fri Jan 09 2026) er mandag
- ✅ `T0411` getMonday(Fri Jan 09 2026) ikke efter input
- ✅ `T0412` getMonday(Fri Jan 09 2026) inden for 7 dage
- ✅ `T0413` getMonday(Fri Jan 09 2026) nulstiller klokkeslæt
- ✅ `T0414` getMonday(Sat Jan 10 2026) er mandag
- ✅ `T0415` getMonday(Sat Jan 10 2026) ikke efter input
- ✅ `T0416` getMonday(Sat Jan 10 2026) inden for 7 dage
- ✅ `T0417` getMonday(Sat Jan 10 2026) nulstiller klokkeslæt
- ✅ `T0418` getMonday(Sun Jan 11 2026) er mandag
- ✅ `T0419` getMonday(Sun Jan 11 2026) ikke efter input
- ✅ `T0420` getMonday(Sun Jan 11 2026) inden for 7 dage
- ✅ `T0421` getMonday(Sun Jan 11 2026) nulstiller klokkeslæt
- ✅ `T0422` getMonday(Mon Jan 12 2026) er mandag
- ✅ `T0423` getMonday(Mon Jan 12 2026) ikke efter input
- ✅ `T0424` getMonday(Mon Jan 12 2026) inden for 7 dage
- ✅ `T0425` getMonday(Mon Jan 12 2026) nulstiller klokkeslæt
- ✅ `T0426` getMonday(Tue Jan 13 2026) er mandag
- ✅ `T0427` getMonday(Tue Jan 13 2026) ikke efter input
- ✅ `T0428` getMonday(Tue Jan 13 2026) inden for 7 dage
- ✅ `T0429` getMonday(Tue Jan 13 2026) nulstiller klokkeslæt
- ✅ `T0430` getMonday(Wed Jan 14 2026) er mandag
- ✅ `T0431` getMonday(Wed Jan 14 2026) ikke efter input
- ✅ `T0432` getMonday(Wed Jan 14 2026) inden for 7 dage
- ✅ `T0433` getMonday(Wed Jan 14 2026) nulstiller klokkeslæt
- ✅ `T0434` getMonday(Thu Jan 15 2026) er mandag
- ✅ `T0435` getMonday(Thu Jan 15 2026) ikke efter input
- ✅ `T0436` getMonday(Thu Jan 15 2026) inden for 7 dage
- ✅ `T0437` getMonday(Thu Jan 15 2026) nulstiller klokkeslæt
- ✅ `T0438` getMonday(Fri Jan 16 2026) er mandag
- ✅ `T0439` getMonday(Fri Jan 16 2026) ikke efter input
- ✅ `T0440` getMonday(Fri Jan 16 2026) inden for 7 dage
- ✅ `T0441` getMonday(Fri Jan 16 2026) nulstiller klokkeslæt
- ✅ `T0442` getMonday(Sat Jan 17 2026) er mandag
- ✅ `T0443` getMonday(Sat Jan 17 2026) ikke efter input
- ✅ `T0444` getMonday(Sat Jan 17 2026) inden for 7 dage
- ✅ `T0445` getMonday(Sat Jan 17 2026) nulstiller klokkeslæt
- ✅ `T0446` getMonday(Sun Jan 18 2026) er mandag
- ✅ `T0447` getMonday(Sun Jan 18 2026) ikke efter input
- ✅ `T0448` getMonday(Sun Jan 18 2026) inden for 7 dage
- ✅ `T0449` getMonday(Sun Jan 18 2026) nulstiller klokkeslæt
- ✅ `T0450` getMonday(Mon Jan 19 2026) er mandag
- ✅ `T0451` getMonday(Mon Jan 19 2026) ikke efter input
- ✅ `T0452` getMonday(Mon Jan 19 2026) inden for 7 dage
- ✅ `T0453` getMonday(Mon Jan 19 2026) nulstiller klokkeslæt
- ✅ `T0454` getMonday(Tue Jan 20 2026) er mandag
- ✅ `T0455` getMonday(Tue Jan 20 2026) ikke efter input
- ✅ `T0456` getMonday(Tue Jan 20 2026) inden for 7 dage
- ✅ `T0457` getMonday(Tue Jan 20 2026) nulstiller klokkeslæt
- ✅ `T0458` getMonday(Wed Jan 21 2026) er mandag
- ✅ `T0459` getMonday(Wed Jan 21 2026) ikke efter input
- ✅ `T0460` getMonday(Wed Jan 21 2026) inden for 7 dage
- ✅ `T0461` getMonday(Wed Jan 21 2026) nulstiller klokkeslæt

### Dato — roundTo15

180 bestået · 0 fejlet · 0 observation(er) — 180 linjer

- ✅ `T0469` roundTo15 min=0 → kvarter
- ✅ `T0470` roundTo15 min=0 nulstiller sekunder
- ✅ `T0471` roundTo15 min=0 korrekt
- ✅ `T0472` roundTo15 min=1 → kvarter
- ✅ `T0473` roundTo15 min=1 nulstiller sekunder
- ✅ `T0474` roundTo15 min=1 korrekt
- ✅ `T0475` roundTo15 min=2 → kvarter
- ✅ `T0476` roundTo15 min=2 nulstiller sekunder
- ✅ `T0477` roundTo15 min=2 korrekt
- ✅ `T0478` roundTo15 min=3 → kvarter
- ✅ `T0479` roundTo15 min=3 nulstiller sekunder
- ✅ `T0480` roundTo15 min=3 korrekt
- ✅ `T0481` roundTo15 min=4 → kvarter
- ✅ `T0482` roundTo15 min=4 nulstiller sekunder
- ✅ `T0483` roundTo15 min=4 korrekt
- ✅ `T0484` roundTo15 min=5 → kvarter
- ✅ `T0485` roundTo15 min=5 nulstiller sekunder
- ✅ `T0486` roundTo15 min=5 korrekt
- ✅ `T0487` roundTo15 min=6 → kvarter
- ✅ `T0488` roundTo15 min=6 nulstiller sekunder
- ✅ `T0489` roundTo15 min=6 korrekt
- ✅ `T0490` roundTo15 min=7 → kvarter
- ✅ `T0491` roundTo15 min=7 nulstiller sekunder
- ✅ `T0492` roundTo15 min=7 korrekt
- ✅ `T0493` roundTo15 min=8 → kvarter
- ✅ `T0494` roundTo15 min=8 nulstiller sekunder
- ✅ `T0495` roundTo15 min=8 korrekt
- ✅ `T0496` roundTo15 min=9 → kvarter
- ✅ `T0497` roundTo15 min=9 nulstiller sekunder
- ✅ `T0498` roundTo15 min=9 korrekt
- ✅ `T0499` roundTo15 min=10 → kvarter
- ✅ `T0500` roundTo15 min=10 nulstiller sekunder
- ✅ `T0501` roundTo15 min=10 korrekt
- ✅ `T0502` roundTo15 min=11 → kvarter
- ✅ `T0503` roundTo15 min=11 nulstiller sekunder
- ✅ `T0504` roundTo15 min=11 korrekt
- ✅ `T0505` roundTo15 min=12 → kvarter
- ✅ `T0506` roundTo15 min=12 nulstiller sekunder
- ✅ `T0507` roundTo15 min=12 korrekt
- ✅ `T0508` roundTo15 min=13 → kvarter
- ✅ `T0509` roundTo15 min=13 nulstiller sekunder
- ✅ `T0510` roundTo15 min=13 korrekt
- ✅ `T0511` roundTo15 min=14 → kvarter
- ✅ `T0512` roundTo15 min=14 nulstiller sekunder
- ✅ `T0513` roundTo15 min=14 korrekt
- ✅ `T0514` roundTo15 min=15 → kvarter
- ✅ `T0515` roundTo15 min=15 nulstiller sekunder
- ✅ `T0516` roundTo15 min=15 korrekt
- ✅ `T0517` roundTo15 min=16 → kvarter
- ✅ `T0518` roundTo15 min=16 nulstiller sekunder
- ✅ `T0519` roundTo15 min=16 korrekt
- ✅ `T0520` roundTo15 min=17 → kvarter
- ✅ `T0521` roundTo15 min=17 nulstiller sekunder
- ✅ `T0522` roundTo15 min=17 korrekt
- ✅ `T0523` roundTo15 min=18 → kvarter
- ✅ `T0524` roundTo15 min=18 nulstiller sekunder
- ✅ `T0525` roundTo15 min=18 korrekt
- ✅ `T0526` roundTo15 min=19 → kvarter
- ✅ `T0527` roundTo15 min=19 nulstiller sekunder
- ✅ `T0528` roundTo15 min=19 korrekt
- ✅ `T0529` roundTo15 min=20 → kvarter
- ✅ `T0530` roundTo15 min=20 nulstiller sekunder
- ✅ `T0531` roundTo15 min=20 korrekt
- ✅ `T0532` roundTo15 min=21 → kvarter
- ✅ `T0533` roundTo15 min=21 nulstiller sekunder
- ✅ `T0534` roundTo15 min=21 korrekt
- ✅ `T0535` roundTo15 min=22 → kvarter
- ✅ `T0536` roundTo15 min=22 nulstiller sekunder
- ✅ `T0537` roundTo15 min=22 korrekt
- ✅ `T0538` roundTo15 min=23 → kvarter
- ✅ `T0539` roundTo15 min=23 nulstiller sekunder
- ✅ `T0540` roundTo15 min=23 korrekt
- ✅ `T0541` roundTo15 min=24 → kvarter
- ✅ `T0542` roundTo15 min=24 nulstiller sekunder
- ✅ `T0543` roundTo15 min=24 korrekt
- ✅ `T0544` roundTo15 min=25 → kvarter
- ✅ `T0545` roundTo15 min=25 nulstiller sekunder
- ✅ `T0546` roundTo15 min=25 korrekt
- ✅ `T0547` roundTo15 min=26 → kvarter
- ✅ `T0548` roundTo15 min=26 nulstiller sekunder
- ✅ `T0549` roundTo15 min=26 korrekt
- ✅ `T0550` roundTo15 min=27 → kvarter
- ✅ `T0551` roundTo15 min=27 nulstiller sekunder
- ✅ `T0552` roundTo15 min=27 korrekt
- ✅ `T0553` roundTo15 min=28 → kvarter
- ✅ `T0554` roundTo15 min=28 nulstiller sekunder
- ✅ `T0555` roundTo15 min=28 korrekt
- ✅ `T0556` roundTo15 min=29 → kvarter
- ✅ `T0557` roundTo15 min=29 nulstiller sekunder
- ✅ `T0558` roundTo15 min=29 korrekt
- ✅ `T0559` roundTo15 min=30 → kvarter
- ✅ `T0560` roundTo15 min=30 nulstiller sekunder
- ✅ `T0561` roundTo15 min=30 korrekt
- ✅ `T0562` roundTo15 min=31 → kvarter
- ✅ `T0563` roundTo15 min=31 nulstiller sekunder
- ✅ `T0564` roundTo15 min=31 korrekt
- ✅ `T0565` roundTo15 min=32 → kvarter
- ✅ `T0566` roundTo15 min=32 nulstiller sekunder
- ✅ `T0567` roundTo15 min=32 korrekt
- ✅ `T0568` roundTo15 min=33 → kvarter
- ✅ `T0569` roundTo15 min=33 nulstiller sekunder
- ✅ `T0570` roundTo15 min=33 korrekt
- ✅ `T0571` roundTo15 min=34 → kvarter
- ✅ `T0572` roundTo15 min=34 nulstiller sekunder
- ✅ `T0573` roundTo15 min=34 korrekt
- ✅ `T0574` roundTo15 min=35 → kvarter
- ✅ `T0575` roundTo15 min=35 nulstiller sekunder
- ✅ `T0576` roundTo15 min=35 korrekt
- ✅ `T0577` roundTo15 min=36 → kvarter
- ✅ `T0578` roundTo15 min=36 nulstiller sekunder
- ✅ `T0579` roundTo15 min=36 korrekt
- ✅ `T0580` roundTo15 min=37 → kvarter
- ✅ `T0581` roundTo15 min=37 nulstiller sekunder
- ✅ `T0582` roundTo15 min=37 korrekt
- ✅ `T0583` roundTo15 min=38 → kvarter
- ✅ `T0584` roundTo15 min=38 nulstiller sekunder
- ✅ `T0585` roundTo15 min=38 korrekt
- ✅ `T0586` roundTo15 min=39 → kvarter
- ✅ `T0587` roundTo15 min=39 nulstiller sekunder
- ✅ `T0588` roundTo15 min=39 korrekt
- ✅ `T0589` roundTo15 min=40 → kvarter
- ✅ `T0590` roundTo15 min=40 nulstiller sekunder
- ✅ `T0591` roundTo15 min=40 korrekt
- ✅ `T0592` roundTo15 min=41 → kvarter
- ✅ `T0593` roundTo15 min=41 nulstiller sekunder
- ✅ `T0594` roundTo15 min=41 korrekt
- ✅ `T0595` roundTo15 min=42 → kvarter
- ✅ `T0596` roundTo15 min=42 nulstiller sekunder
- ✅ `T0597` roundTo15 min=42 korrekt
- ✅ `T0598` roundTo15 min=43 → kvarter
- ✅ `T0599` roundTo15 min=43 nulstiller sekunder
- ✅ `T0600` roundTo15 min=43 korrekt
- ✅ `T0601` roundTo15 min=44 → kvarter
- ✅ `T0602` roundTo15 min=44 nulstiller sekunder
- ✅ `T0603` roundTo15 min=44 korrekt
- ✅ `T0604` roundTo15 min=45 → kvarter
- ✅ `T0605` roundTo15 min=45 nulstiller sekunder
- ✅ `T0606` roundTo15 min=45 korrekt
- ✅ `T0607` roundTo15 min=46 → kvarter
- ✅ `T0608` roundTo15 min=46 nulstiller sekunder
- ✅ `T0609` roundTo15 min=46 korrekt
- ✅ `T0610` roundTo15 min=47 → kvarter
- ✅ `T0611` roundTo15 min=47 nulstiller sekunder
- ✅ `T0612` roundTo15 min=47 korrekt
- ✅ `T0613` roundTo15 min=48 → kvarter
- ✅ `T0614` roundTo15 min=48 nulstiller sekunder
- ✅ `T0615` roundTo15 min=48 korrekt
- ✅ `T0616` roundTo15 min=49 → kvarter
- ✅ `T0617` roundTo15 min=49 nulstiller sekunder
- ✅ `T0618` roundTo15 min=49 korrekt
- ✅ `T0619` roundTo15 min=50 → kvarter
- ✅ `T0620` roundTo15 min=50 nulstiller sekunder
- ✅ `T0621` roundTo15 min=50 korrekt
- ✅ `T0622` roundTo15 min=51 → kvarter
- ✅ `T0623` roundTo15 min=51 nulstiller sekunder
- ✅ `T0624` roundTo15 min=51 korrekt
- ✅ `T0625` roundTo15 min=52 → kvarter
- ✅ `T0626` roundTo15 min=52 nulstiller sekunder
- ✅ `T0627` roundTo15 min=52 korrekt
- ✅ `T0628` roundTo15 min=53 → kvarter
- ✅ `T0629` roundTo15 min=53 nulstiller sekunder
- ✅ `T0630` roundTo15 min=53 korrekt
- ✅ `T0631` roundTo15 min=54 → kvarter
- ✅ `T0632` roundTo15 min=54 nulstiller sekunder
- ✅ `T0633` roundTo15 min=54 korrekt
- ✅ `T0634` roundTo15 min=55 → kvarter
- ✅ `T0635` roundTo15 min=55 nulstiller sekunder
- ✅ `T0636` roundTo15 min=55 korrekt
- ✅ `T0637` roundTo15 min=56 → kvarter
- ✅ `T0638` roundTo15 min=56 nulstiller sekunder
- ✅ `T0639` roundTo15 min=56 korrekt
- ✅ `T0640` roundTo15 min=57 → kvarter
- ✅ `T0641` roundTo15 min=57 nulstiller sekunder
- ✅ `T0642` roundTo15 min=57 korrekt
- ✅ `T0643` roundTo15 min=58 → kvarter
- ✅ `T0644` roundTo15 min=58 nulstiller sekunder
- ✅ `T0645` roundTo15 min=58 korrekt
- ✅ `T0646` roundTo15 min=59 → kvarter
- ✅ `T0647` roundTo15 min=59 nulstiller sekunder
- ✅ `T0648` roundTo15 min=59 korrekt

### Format — varighed (H:MM)

10 bestået · 0 fejlet · 0 observation(er) — 10 linjer

- ✅ `T0649` fmtDur(0) = "0:00"
- ✅ `T0650` fmtDur(5) = "0:05"
- ✅ `T0651` fmtDur(59) = "0:59"
- ✅ `T0652` fmtDur(60) = "1:00"
- ✅ `T0653` fmtDur(90) = "1:30"
- ✅ `T0654` fmtDur(125) = "2:05"
- ✅ `T0655` fmtDur(600) = "10:00"
- ✅ `T0656` fmtDur(1440) = "24:00"
- ✅ `T0657` fmtDur(1445) = "24:05"
- ✅ `T0658` fmtDur(61) = "1:01"

### Konfliktinfo — næste ledige tid

4 bestået · 0 fejlet · 0 observation(er) — 4 linjer

- ✅ `T0374` finder konflikt for 11-13
- ✅ `T0375` næste ledige efter sammenhængende blok = 14:00
- ✅ `T0376` ingen konflikt 8-9
- ✅ `T0377` excludeId fjerner eneste konflikt

### Overlap-detektion

65 bestået · 0 fejlet · 0 observation(er) — 65 linjer

- ✅ `T0309` overlap [8-9] (før)
- ✅ `T0310` overlap [8-10] (slutter præcis ved start (rører, ej overlap))
- ✅ `T0311` overlap [8-11] (overlapper start)
- ✅ `T0312` overlap [10-12] (identisk)
- ✅ `T0313` overlap [10.5-11.5] (inde i)
- ✅ `T0314` overlap [9-13] (omslutter)
- ✅ `T0315` overlap [11-13] (overlapper slut)
- ✅ `T0316` overlap [12-14] (starter præcis ved slut (rører, ej overlap))
- ✅ `T0317` overlap [13-14] (efter)
- ✅ `T0318` anden bil overlapper ikke
- ✅ `T0319` annulleret booking tæller ikke
- ✅ `T0320` excludeId udelader egen booking
- ✅ `T0321` completed booking tæller ikke
- ✅ `T0322` matrix start5 varighed1
- ✅ `T0323` matrix start5 varighed2
- ✅ `T0324` matrix start5 varighed3
- ✅ `T0325` matrix start5 varighed4
- ✅ `T0326` matrix start6 varighed1
- ✅ `T0327` matrix start6 varighed2
- ✅ `T0328` matrix start6 varighed3
- ✅ `T0329` matrix start6 varighed4
- ✅ `T0330` matrix start7 varighed1
- ✅ `T0331` matrix start7 varighed2
- ✅ `T0332` matrix start7 varighed3
- ✅ `T0333` matrix start7 varighed4
- ✅ `T0334` matrix start8 varighed1
- ✅ `T0335` matrix start8 varighed2
- ✅ `T0336` matrix start8 varighed3
- ✅ `T0337` matrix start8 varighed4
- ✅ `T0338` matrix start9 varighed1
- ✅ `T0339` matrix start9 varighed2
- ✅ `T0340` matrix start9 varighed3
- ✅ `T0341` matrix start9 varighed4
- ✅ `T0342` matrix start10 varighed1
- ✅ `T0343` matrix start10 varighed2
- ✅ `T0344` matrix start10 varighed3
- ✅ `T0345` matrix start10 varighed4
- ✅ `T0346` matrix start11 varighed1
- ✅ `T0347` matrix start11 varighed2
- ✅ `T0348` matrix start11 varighed3
- ✅ `T0349` matrix start11 varighed4
- ✅ `T0350` matrix start12 varighed1
- ✅ `T0351` matrix start12 varighed2
- ✅ `T0352` matrix start12 varighed3
- ✅ `T0353` matrix start12 varighed4
- ✅ `T0354` matrix start13 varighed1
- ✅ `T0355` matrix start13 varighed2
- ✅ `T0356` matrix start13 varighed3
- ✅ `T0357` matrix start13 varighed4
- ✅ `T0358` matrix start14 varighed1
- ✅ `T0359` matrix start14 varighed2
- ✅ `T0360` matrix start14 varighed3
- ✅ `T0361` matrix start14 varighed4
- ✅ `T0362` matrix start15 varighed1
- ✅ `T0363` matrix start15 varighed2
- ✅ `T0364` matrix start15 varighed3
- ✅ `T0365` matrix start15 varighed4
- ✅ `T0366` matrix start16 varighed1
- ✅ `T0367` matrix start16 varighed2
- ✅ `T0368` matrix start16 varighed3
- ✅ `T0369` matrix start16 varighed4
- ✅ `T0370` matrix start17 varighed1
- ✅ `T0371` matrix start17 varighed2
- ✅ `T0372` matrix start17 varighed3
- ✅ `T0373` matrix start17 varighed4

### Priser — brugerdefinerede satser

4 bestået · 0 fejlet · 0 observation(er) — 4 linjer

- ✅ `T0305` custom: 40 km standard = 200
- ✅ `T0306` custom: 60 km standard = 50*5+10*4=290
- ✅ `T0307` custom: 5 timer = 100
- ✅ `T0308` custom: 24 timer = 200

### Priser — km (el)

134 bestået · 0 fejlet · 0 observation(er) — 134 linjer

- ✅ `T0148` el 0 km
- ✅ `T0149` el 2 km
- ✅ `T0150` el 4 km
- ✅ `T0151` el 6 km
- ✅ `T0152` el 8 km
- ✅ `T0153` el 10 km
- ✅ `T0154` el 12 km
- ✅ `T0155` el 14 km
- ✅ `T0156` el 16 km
- ✅ `T0157` el 18 km
- ✅ `T0158` el 20 km
- ✅ `T0159` el 22 km
- ✅ `T0160` el 24 km
- ✅ `T0161` el 26 km
- ✅ `T0162` el 28 km
- ✅ `T0163` el 30 km
- ✅ `T0164` el 32 km
- ✅ `T0165` el 34 km
- ✅ `T0166` el 36 km
- ✅ `T0167` el 38 km
- ✅ `T0168` el 40 km
- ✅ `T0169` el 42 km
- ✅ `T0170` el 44 km
- ✅ `T0171` el 46 km
- ✅ `T0172` el 48 km
- ✅ `T0173` el 50 km
- ✅ `T0174` el 52 km
- ✅ `T0175` el 54 km
- ✅ `T0176` el 56 km
- ✅ `T0177` el 58 km
- ✅ `T0178` el 60 km
- ✅ `T0179` el 62 km
- ✅ `T0180` el 64 km
- ✅ `T0181` el 66 km
- ✅ `T0182` el 68 km
- ✅ `T0183` el 70 km
- ✅ `T0184` el 72 km
- ✅ `T0185` el 74 km
- ✅ `T0186` el 76 km
- ✅ `T0187` el 78 km
- ✅ `T0188` el 80 km
- ✅ `T0189` el 82 km
- ✅ `T0190` el 84 km
- ✅ `T0191` el 86 km
- ✅ `T0192` el 88 km
- ✅ `T0193` el 90 km
- ✅ `T0194` el 92 km
- ✅ `T0195` el 94 km
- ✅ `T0196` el 96 km
- ✅ `T0197` el 98 km
- ✅ `T0198` el 100 km
- ✅ `T0199` el 102 km
- ✅ `T0200` el 104 km
- ✅ `T0201` el 106 km
- ✅ `T0202` el 108 km
- ✅ `T0203` el 110 km
- ✅ `T0204` el 112 km
- ✅ `T0205` el 114 km
- ✅ `T0206` el 116 km
- ✅ `T0207` el 118 km
- ✅ `T0208` el 120 km
- ✅ `T0209` el 122 km
- ✅ `T0210` el 124 km
- ✅ `T0211` el 126 km
- ✅ `T0212` el 128 km
- ✅ `T0213` el 130 km
- ✅ `T0214` el 132 km
- ✅ `T0215` el 134 km
- ✅ `T0216` el 136 km
- ✅ `T0217` el 138 km
- ✅ `T0218` el 140 km
- ✅ `T0219` el 142 km
- ✅ `T0220` el 144 km
- ✅ `T0221` el 146 km
- ✅ `T0222` el 148 km
- ✅ `T0223` el 150 km
- ✅ `T0224` el 152 km
- ✅ `T0225` el 154 km
- ✅ `T0226` el 156 km
- ✅ `T0227` el 158 km
- ✅ `T0228` el 160 km
- ✅ `T0229` el 162 km
- ✅ `T0230` el 164 km
- ✅ `T0231` el 166 km
- ✅ `T0232` el 168 km
- ✅ `T0233` el 170 km
- ✅ `T0234` el 172 km
- ✅ `T0235` el 174 km
- ✅ `T0236` el 176 km
- ✅ `T0237` el 178 km
- ✅ `T0238` el 180 km
- ✅ `T0239` el 182 km
- ✅ `T0240` el 184 km
- ✅ `T0241` el 186 km
- ✅ `T0242` el 188 km
- ✅ `T0243` el 190 km
- ✅ `T0244` el 192 km
- ✅ `T0245` el 194 km
- ✅ `T0246` el 196 km
- ✅ `T0247` el 198 km
- ✅ `T0248` el 200 km
- ✅ `T0249` el 202 km
- ✅ `T0250` el 204 km
- ✅ `T0251` el 206 km
- ✅ `T0252` el 208 km
- ✅ `T0253` el 210 km
- ✅ `T0254` el 212 km
- ✅ `T0255` el 214 km
- ✅ `T0256` el 216 km
- ✅ `T0257` el 218 km
- ✅ `T0258` el 220 km
- ✅ `T0259` el 222 km
- ✅ `T0260` el 224 km
- ✅ `T0261` el 226 km
- ✅ `T0262` el 228 km
- ✅ `T0263` el 230 km
- ✅ `T0264` el 232 km
- ✅ `T0265` el 234 km
- ✅ `T0266` el 236 km
- ✅ `T0267` el 238 km
- ✅ `T0268` el 240 km
- ✅ `T0269` el 242 km
- ✅ `T0270` el 244 km
- ✅ `T0271` el 246 km
- ✅ `T0272` el 248 km
- ✅ `T0273` el 250 km
- ✅ `T0274` el 252 km
- ✅ `T0275` el 254 km
- ✅ `T0276` el 256 km
- ✅ `T0277` el 258 km
- ✅ `T0278` el 260 km
- ✅ `T0279` el netop tærskel
- ✅ `T0280` el 1 over tærskel
- ✅ `T0281` km-pris monotont stigende (standard)

### Priser — km (standard)

135 bestået · 0 fejlet · 0 observation(er) — 135 linjer

- ✅ `T0013` standard 0 km
- ✅ `T0014` standard 2 km
- ✅ `T0015` standard 4 km
- ✅ `T0016` standard 6 km
- ✅ `T0017` standard 8 km
- ✅ `T0018` standard 10 km
- ✅ `T0019` standard 12 km
- ✅ `T0020` standard 14 km
- ✅ `T0021` standard 16 km
- ✅ `T0022` standard 18 km
- ✅ `T0023` standard 20 km
- ✅ `T0024` standard 22 km
- ✅ `T0025` standard 24 km
- ✅ `T0026` standard 26 km
- ✅ `T0027` standard 28 km
- ✅ `T0028` standard 30 km
- ✅ `T0029` standard 32 km
- ✅ `T0030` standard 34 km
- ✅ `T0031` standard 36 km
- ✅ `T0032` standard 38 km
- ✅ `T0033` standard 40 km
- ✅ `T0034` standard 42 km
- ✅ `T0035` standard 44 km
- ✅ `T0036` standard 46 km
- ✅ `T0037` standard 48 km
- ✅ `T0038` standard 50 km
- ✅ `T0039` standard 52 km
- ✅ `T0040` standard 54 km
- ✅ `T0041` standard 56 km
- ✅ `T0042` standard 58 km
- ✅ `T0043` standard 60 km
- ✅ `T0044` standard 62 km
- ✅ `T0045` standard 64 km
- ✅ `T0046` standard 66 km
- ✅ `T0047` standard 68 km
- ✅ `T0048` standard 70 km
- ✅ `T0049` standard 72 km
- ✅ `T0050` standard 74 km
- ✅ `T0051` standard 76 km
- ✅ `T0052` standard 78 km
- ✅ `T0053` standard 80 km
- ✅ `T0054` standard 82 km
- ✅ `T0055` standard 84 km
- ✅ `T0056` standard 86 km
- ✅ `T0057` standard 88 km
- ✅ `T0058` standard 90 km
- ✅ `T0059` standard 92 km
- ✅ `T0060` standard 94 km
- ✅ `T0061` standard 96 km
- ✅ `T0062` standard 98 km
- ✅ `T0063` standard 100 km
- ✅ `T0064` standard 102 km
- ✅ `T0065` standard 104 km
- ✅ `T0066` standard 106 km
- ✅ `T0067` standard 108 km
- ✅ `T0068` standard 110 km
- ✅ `T0069` standard 112 km
- ✅ `T0070` standard 114 km
- ✅ `T0071` standard 116 km
- ✅ `T0072` standard 118 km
- ✅ `T0073` standard 120 km
- ✅ `T0074` standard 122 km
- ✅ `T0075` standard 124 km
- ✅ `T0076` standard 126 km
- ✅ `T0077` standard 128 km
- ✅ `T0078` standard 130 km
- ✅ `T0079` standard 132 km
- ✅ `T0080` standard 134 km
- ✅ `T0081` standard 136 km
- ✅ `T0082` standard 138 km
- ✅ `T0083` standard 140 km
- ✅ `T0084` standard 142 km
- ✅ `T0085` standard 144 km
- ✅ `T0086` standard 146 km
- ✅ `T0087` standard 148 km
- ✅ `T0088` standard 150 km
- ✅ `T0089` standard 152 km
- ✅ `T0090` standard 154 km
- ✅ `T0091` standard 156 km
- ✅ `T0092` standard 158 km
- ✅ `T0093` standard 160 km
- ✅ `T0094` standard 162 km
- ✅ `T0095` standard 164 km
- ✅ `T0096` standard 166 km
- ✅ `T0097` standard 168 km
- ✅ `T0098` standard 170 km
- ✅ `T0099` standard 172 km
- ✅ `T0100` standard 174 km
- ✅ `T0101` standard 176 km
- ✅ `T0102` standard 178 km
- ✅ `T0103` standard 180 km
- ✅ `T0104` standard 182 km
- ✅ `T0105` standard 184 km
- ✅ `T0106` standard 186 km
- ✅ `T0107` standard 188 km
- ✅ `T0108` standard 190 km
- ✅ `T0109` standard 192 km
- ✅ `T0110` standard 194 km
- ✅ `T0111` standard 196 km
- ✅ `T0112` standard 198 km
- ✅ `T0113` standard 200 km
- ✅ `T0114` standard 202 km
- ✅ `T0115` standard 204 km
- ✅ `T0116` standard 206 km
- ✅ `T0117` standard 208 km
- ✅ `T0118` standard 210 km
- ✅ `T0119` standard 212 km
- ✅ `T0120` standard 214 km
- ✅ `T0121` standard 216 km
- ✅ `T0122` standard 218 km
- ✅ `T0123` standard 220 km
- ✅ `T0124` standard 222 km
- ✅ `T0125` standard 224 km
- ✅ `T0126` standard 226 km
- ✅ `T0127` standard 228 km
- ✅ `T0128` standard 230 km
- ✅ `T0129` standard 232 km
- ✅ `T0130` standard 234 km
- ✅ `T0131` standard 236 km
- ✅ `T0132` standard 238 km
- ✅ `T0133` standard 240 km
- ✅ `T0134` standard 242 km
- ✅ `T0135` standard 244 km
- ✅ `T0136` standard 246 km
- ✅ `T0137` standard 248 km
- ✅ `T0138` standard 250 km
- ✅ `T0139` standard 252 km
- ✅ `T0140` standard 254 km
- ✅ `T0141` standard 256 km
- ✅ `T0142` standard 258 km
- ✅ `T0143` standard 260 km
- ✅ `T0144` standard negativ km = 0
- ✅ `T0145` standard km=null = 0
- ✅ `T0146` standard netop tærskel (100)
- ✅ `T0147` standard 1 over tærskel

### Priser — tid

20 bestået · 0 fejlet · 3 observation(er) — 23 linjer

- ✅ `T0282` tidspris 0 min
- ✅ `T0283` tidspris 15 min
- ✅ `T0284` tidspris 30 min
- ✅ `T0285` tidspris 45 min
- ✅ `T0286` tidspris 60 min
- ✅ `T0287` tidspris 90 min
- ✅ `T0288` tidspris 120 min
- ✅ `T0289` tidspris 180 min
- ✅ `T0290` tidspris 360 min
- ✅ `T0291` tidspris 600 min
- ✅ `T0292` tidspris 720 min
- ✅ `T0293` tidspris 1380 min
- ✅ `T0294` tidspris 1439 min
- ✅ `T0295` tidspris 1440 min
- ✅ `T0296` tidspris 1441 min
- ✅ `T0297` tidspris 1500 min
- ✅ `T0298` tidspris 2160 min
- ✅ `T0299` tidspris 2820 min
- ✅ `T0300` tidspris 2880 min
- ✅ `T0301` tidspris 4320 min
- 🔎 `T0302` Tidspris er IKKE monotont stigende — Ved 1439 min koster det 359.75 kr., men ved 1440 min kun 150.00 kr. En længere booking bliver altså billigere. Sker fordi 24 t afregnes som 1 døgn (150 kr.), mens 23 t afregnes som 23×15=345 kr. Overvej at tage min(døgn, timer×sats) pr. påbegyndt døgn.
- 🔎 `T0303` 23 timer dyrere end 24 timer — 23t=345.00 kr. vs 24t=150.00 kr.
- 🔎 `T0304` 47 timer dyrere end 48 timer — 47t=495.00 kr. vs 48t=300.00 kr.

---
_Genereret automatisk af scripts/tests/run-all.mjs. Kør igen via workflowet "Test af systemet" (workflow_dispatch)._