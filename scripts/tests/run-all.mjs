// Kører alle tests og skriver en grupperet logfil (TEST-LOG.md) i repoets rod.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { results } from './harness.mjs';
import { runLogicTests } from './logic.test.mjs';
import { runBackendTests, cleanup, verifyClean } from './backend.test.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '..', 'TEST-LOG.md');

const now = new Date();
const stamp = now.toISOString();

console.log('▶ Kører logik-tests ...');
try { runLogicTests(); } catch (e) { console.error('Logik-tests krasjede:', e); results.push({ group: 'Logik (kørselsfejl)', id: 'T0000', desc: 'runLogicTests kastede exception', status: 'FAIL', detail: String(e && e.stack || e) }); }

console.log('▶ Kører backend-tests mod live Supabase ...');
let cleanupSummary = null, leftover = null, runId = null;
try {
  const { RUN, created } = await runBackendTests();
  runId = RUN;
  console.log('▶ Rydder testdata op ...');
  cleanupSummary = await cleanup(created);
  leftover = await verifyClean(RUN);
} catch (e) {
  console.error('Backend-tests krasjede:', e);
  results.push({ group: 'Backend (kørselsfejl)', id: 'T0000', desc: 'runBackendTests kastede exception', status: 'FAIL', detail: String(e && e.stack || e) });
}

// ---- Gruppér resultater ----
const groups = new Map();
for (const r of results) {
  if (!groups.has(r.group)) groups.set(r.group, []);
  groups.get(r.group).push(r);
}

let totPass = 0, totFail = 0, totFinding = 0;
for (const r of results) {
  if (r.status === 'PASS') totPass++;
  else if (r.status === 'FAIL') totFail++;
  else if (r.status === 'FINDING') totFinding++;
}
const total = totPass + totFail; // findings tælles ikke som tests

// ---- Byg markdown ----
const L = [];
L.push('# Testlog — bilbooking');
L.push('');
L.push(`**Kørt:** ${stamp}`);
L.push(`**Miljø:** GitHub Actions (Node ${process.version}, TZ=${process.env.TZ || 'ukendt'})`);
L.push('');
L.push('## Sammendrag');
L.push('');
L.push(`- **Tests i alt:** ${total}`);
L.push(`- ✅ **Bestået:** ${totPass}`);
L.push(`- ❌ **Fejlet:** ${totFail}`);
L.push(`- 🔎 **Observationer (findings):** ${totFinding}`);
L.push('');

// Fejl-oversigt øverst
const fails = results.filter(r => r.status === 'FAIL');
const findings = results.filter(r => r.status === 'FINDING');

if (fails.length) {
  L.push('### ❌ Fejlede tests');
  L.push('');
  for (const f of fails) L.push(`- **[${f.group}] ${f.desc}** — ${f.detail}`);
  L.push('');
} else {
  L.push('### ❌ Fejlede tests');
  L.push('');
  L.push('_Ingen fejlede tests._');
  L.push('');
}

if (findings.length) {
  L.push('### 🔎 Observationer & anbefalinger');
  L.push('');
  for (const f of findings) {
    L.push(`- **[${f.group}] ${f.desc}**`);
    L.push(`  - ${f.detail}`);
  }
  L.push('');
}

// Oprydning
L.push('## Oprydning af testdata');
L.push('');
if (cleanupSummary) {
  L.push(`- Slettede rækker: bookinger ${cleanupSummary.bookings}, medlemmer ${cleanupSummary.members}, leveringer ${cleanupSummary.deliveries}, indstillinger ${cleanupSummary.settings}`);
  if (cleanupSummary.errors.length) L.push(`- ⚠️ Fejl under sletning: ${cleanupSummary.errors.join('; ')}`);
  if (leftover) {
    const clean = Object.values(leftover).every(v => v === 0);
    L.push(`- Efterladt testdata (skal være 0): medlemmer ${leftover.members}, bookinger ${leftover.bookings}, indstillinger ${leftover.settings} ${clean ? '✅' : '⚠️'}`);
  }
} else {
  L.push('- ⚠️ Oprydning blev ikke gennemført (backend-tests krasjede).');
}
L.push('');

// ---- Detaljeret log pr. gruppe ----
L.push('## Detaljeret log (grupperet efter type)');
L.push('');
const groupNames = [...groups.keys()].sort();
for (const gname of groupNames) {
  const rows = groups.get(gname);
  const p = rows.filter(r => r.status === 'PASS').length;
  const f = rows.filter(r => r.status === 'FAIL').length;
  const fi = rows.filter(r => r.status === 'FINDING').length;
  L.push(`### ${gname}`);
  L.push('');
  L.push(`${p} bestået · ${f} fejlet · ${fi} observation(er) — ${rows.length} linjer`);
  L.push('');
  for (const r of rows) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '🔎';
    L.push(`- ${icon} \`${r.id}\` ${r.desc}${r.detail ? ' — ' + r.detail : ''}`);
  }
  L.push('');
}

L.push('---');
L.push(`_Genereret automatisk af scripts/tests/run-all.mjs. Kør igen via workflowet "Test af systemet" (workflow_dispatch)._`);

fs.writeFileSync(OUT, L.join('\n'));
console.log(`\n✔ Skrev ${OUT}`);
console.log(`Sammendrag: ${totPass} bestået, ${totFail} fejlet, ${totFinding} observationer (i alt ${total} tests).`);

// Skriv også en maskinlæsbar status til stdout for workflowet.
console.log(`::notice::Tests: ${totPass} PASS, ${totFail} FAIL, ${totFinding} FINDINGS`);
// Fejl må gerne markere jobbet, men vi vil stadig committe loggen — så vi
// afslutter altid 0 her; workflowet committer loggen uanset.
process.exit(0);
