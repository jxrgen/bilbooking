// Automatisk backup af alle bookinger.
// Køres af .github/workflows/backup.yml. Læser indstillinger (frekvens, SMTP,
// modtager-email) fra Supabase settings-tabellen, skriver en JSON-fil til
// backups/ (som committes til repoet = "server"), og sender den som vedhæftning.
//
// Miljøvariabler: SUPABASE_URL, SUPABASE_KEY

import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Mangler SUPABASE_URL / SUPABASE_KEY');
  process.exit(1);
}

async function sb(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${query}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ISO-ugenummer (UTC)
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

const settingsRows = await sb('settings?select=key,value');
const S = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

// Beslut om denne (ugentlige) kørsel skal udføre backup
const freq = S.backup_frequency || 'monthly';
const now  = new Date();
const day  = now.getUTCDate();
const week = isoWeek(now);
let shouldRun;
if (freq === 'weekly')        shouldRun = true;
else if (freq === 'biweekly') shouldRun = week % 2 === 0;
else                          shouldRun = day <= 7; // monthly: første kørsel i måneden

if (!shouldRun) {
  console.log(`Frekvens="${freq}" (uge ${week}, dag ${day}) — ingen backup denne uge.`);
  process.exit(0);
}

// Hent alle bookinger inkl. bil og aflevering
const bookings = await sb('bookings?select=*,cars(name),deliveries(*)&order=start_time.asc');

const stamp = now.toISOString().slice(0, 10);
const payload = {
  generated_at: now.toISOString(),
  club:  S.club_name || 'Delebilsklub',
  count: bookings.length,
  bookings,
};
const json = JSON.stringify(payload, null, 2);

// Gem på "serveren" (committes af workflowet)
const dir = 'backups';
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `bookings-${stamp}.json`);
fs.writeFileSync(file, json);
console.log(`Skrev ${file} (${bookings.length} bookinger)`);

// Send som email hvis SMTP + modtager er konfigureret
if (S.smtp_host && S.backup_email) {
  const port = Number(S.smtp_port || 587);
  const transporter = nodemailer.createTransport({
    host: S.smtp_host,
    port,
    secure: port === 465,
    auth: S.smtp_user ? { user: S.smtp_user, pass: S.smtp_pass } : undefined,
  });
  await transporter.sendMail({
    from: S.smtp_from || S.smtp_user,
    to: S.backup_email,
    subject: `Backup af bookinger — ${stamp}`,
    text: `Automatisk backup fra ${S.club_name || 'Delebilsklub'}.\n`
        + `${bookings.length} bookinger er vedhæftet som JSON.\n\nFrekvens: ${freq}.`,
    attachments: [{ filename: `bookings-${stamp}.json`, content: json }],
  });
  console.log(`Sendte backup til ${S.backup_email}`);
} else {
  console.log('SMTP-server eller modtager-email ikke konfigureret — springer email over.');
}
