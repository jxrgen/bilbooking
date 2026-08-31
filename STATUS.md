# Status — bilbooking

**Senest opdateret:** 2026-08-31

Denne fil opsummerer arbejdet udført i den seneste session. Den detaljerede
testlog ligger i [`TEST-LOG.md`](TEST-LOG.md).

---

## 1. Backup-fejlen — rettet ✅

**Symptom:** GitHub Actions "Backup af bookinger" fejlede ("All jobs have failed").

**Årsag:** Commit-steppet crashede med `git add backups/ did not match any files`
(exit 128), fordi det kørte selv når backup-scriptet med vilje sprang backup over
(frekvens `monthly`, kørt uden for månedens første uge → ingen `backups/`-mappe).
Selve backuppen fejlede altså ikke.

**Rettelse** (commit på `main`):
- Commit-steppet tjekker nu `[ -d backups ]` før `git add`.
- Manuel kørsel (`workflow_dispatch`) sætter `FORCE_BACKUP=true`, så en manuel
  kørsel altid laver en backup uanset frekvens-indstillingen.

**Bekræftet:** Manuel kørsel lykkedes og skrev `backups/bookings-2026-08-31.json`
(46 bookinger).

---

## 2. Automatisk testsuite — tilføjet ✅

Kørt på GitHub Actions (node findes ikke lokalt). Se `scripts/tests/` og
workflowet `.github/workflows/tests.yml` ("Test af systemet", kør manuelt).

- **Logik-tests:** kører de rigtige funktioner fra `app.js` i en `node:vm`-sandbox
  (priser, km-tiers, tidspris, overlap, konfliktinfo, dato/uge, varighed).
- **Backend-tests:** CRUD for medlemmer/bookinger/leveringer, DB-constraints og
  settings-sikkerhed mod det live Supabase via REST. Al testdata tagges `ZZTEST_<ts>`
  og ryddes op igen.

**Resultat: 696 bestået · 0 fejlet · 6 observationer.**

---

## 3. Observationer (ingen decideret bug, men værd at kigge på)

| # | Observation | Anbefaling |
|---|-------------|------------|
| 1 | Tidspris ikke monotont stigende: 23 t = 345 kr. men 24 t = 150 kr. (også 47 t > 48 t) | Overvej `min(døgn, timer×sats)` pr. påbegyndt døgn i `calcTimeCost` |
| 2 | Ingen DB-spærring mod dobbeltbooking — kun JS-forhåndstjek → race condition | Tilføj PostgreSQL `EXCLUDE`-constraint (btree_gist) på bil + tidsrum |
| 3 | `admin_password` er læsbar med appens offentlige nøgle | Flyt admin-login til en Edge Function / begræns SELECT |
| 4 | `settings` mangler DELETE-politik → DELETE giver HTTP 200 men sletter 0 rækker | Bevidst valg? Ellers tilføj politik |

Vigtigst praktisk: **#1 (prisspring)** og **#2 (dobbeltbooking)**.

---

## 4. Udestående oprydning ⚠️

Én harmløs testnøgle kunne ikke slettes via den offentlige nøgle (pga. observation #4).
Den påvirker hverken app eller backup, men fjernes helt ved at køre i
**Supabase → SQL Editor**:

```sql
DELETE FROM settings WHERE key LIKE 'zz_selftest_%';
```

Alt øvrigt testdata er ryddet op (0 testmedlemmer, 0 testbookinger, 46 rigtige
bookinger uændret).
