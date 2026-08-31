// Backend-tests mod det LIVE Supabase (PostgREST) med appens offentlige nøgle.
// Tester CRUD for medlemmer/bookinger/leveringer, DB-constraints og
// settings-sikkerhed. AL testdata tagges med et unikt RUN-præfiks og slettes
// igen til sidst (kun rækker vi selv har oprettet).

import { record, eq, check, finding } from './harness.mjs';

const URL = process.env.SUPABASE_URL || 'https://fdwiooogkophykysbbrh.supabase.co';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_TEUUw-SUTC_XyQ3aNK1VKg_s9A8WAf4';
const RUN = 'ZZTEST_' + Date.now();

// Sporing af alt vi opretter, så oprydningen er kirurgisk.
const created = { bookings: [], members: [], deliveries: [], settings: [] };

async function req(method, pathQ, body, prefer = 'return=representation') {
  const res = await fetch(`${URL}/rest/v1/${pathQ}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, ok: res.ok, data };
}

export async function runBackendTests() {
  const G = {
    conn: 'Backend — forbindelse & læsning',
    mem: 'Backend — medlemmer (CRUD)',
    book: 'Backend — bookinger (CRUD)',
    del: 'Backend — leveringer',
    con: 'Backend — DB-constraints',
    sec: 'Backend — settings & sikkerhed',
    ov: 'Backend — overlap & samtidighed',
  };

  // ---------- Forbindelse & basisdata ----------
  const cars = await req('GET', 'cars?select=id,name,active&order=created_at.asc');
  eq(G.conn, 'kan læse cars-tabellen (HTTP 200)', cars.status, 200);
  check(G.conn, 'mindst én bil findes', () => Array.isArray(cars.data) && cars.data.length > 0);
  const CAR = Array.isArray(cars.data) && cars.data[0] ? cars.data[0].id : null;
  const CAR2 = Array.isArray(cars.data) && cars.data[1] ? cars.data[1].id : CAR;

  const settingsRead = await req('GET', 'settings?select=key,value');
  eq(G.conn, 'kan læse settings-tabellen', settingsRead.status, 200);
  const memRead = await req('GET', 'members?select=id&limit=1');
  eq(G.conn, 'kan læse members-tabellen', memRead.status, 200);
  const bookRead = await req('GET', 'bookings?select=id&limit=1');
  eq(G.conn, 'kan læse bookings-tabellen', bookRead.status, 200);

  if (!CAR) {
    record(G.conn, 'ingen bil at teste bookinger mod — springer resten over', 'FAIL', 'cars tom');
    return { RUN, created };
  }

  // ---------- Medlemmer: CRUD (flere brugere) ----------
  const memberNames = ['Alice', 'Bob', 'Citra', 'Dan', 'Eva'];
  for (const nm of memberNames) {
    const ins = await req('POST', 'members', { navn: `${RUN}_${nm}`, telefon: '10000000', bogruppe: '9' });
    const okId = ins.ok && Array.isArray(ins.data) && ins.data[0] && ins.data[0].id;
    eq(G.mem, `opret medlem ${nm}`, ins.status, 201);
    if (okId) created.members.push(ins.data[0].id);
  }
  // Læs dem tilbage
  const listed = await req('GET', `members?select=id,navn,active&navn=like.${RUN}_*`);
  eq(G.mem, 'læs egne testmedlemmer tilbage', Array.isArray(listed.data) ? listed.data.length : -1, memberNames.length);
  check(G.mem, 'nye medlemmer er aktive som standard', () => Array.isArray(listed.data) && listed.data.every(m => m.active === true));
  // Opdatér ét
  if (created.members[0]) {
    const upd = await req('PATCH', `members?id=eq.${created.members[0]}`, { telefon: '99999999' });
    eq(G.mem, 'opdatér medlems telefon', upd.status, 200);
    const back = await req('GET', `members?select=telefon&id=eq.${created.members[0]}`);
    eq(G.mem, 'opdatering gemt korrekt', Array.isArray(back.data) && back.data[0] ? back.data[0].telefon : null, '99999999');
  }
  // Deaktivér (soft) ét
  if (created.members[1]) {
    const de = await req('PATCH', `members?id=eq.${created.members[1]}`, { active: false });
    eq(G.mem, 'kan deaktivere medlem', de.status, 200);
  }

  // ---------- Bookinger: CRUD ----------
  const mkBooking = (over = {}) => ({
    car_id: CAR, user_name: `${RUN}_bruger`, phone: '12345678',
    expected_km: 50, start_km: 1000,
    start_time: '2027-03-01T10:00:00Z', end_time: '2027-03-01T12:00:00Z',
    notes: RUN, ...over,
  });
  const b1 = await req('POST', 'bookings', mkBooking());
  eq(G.book, 'opret gyldig booking', b1.status, 201);
  const B1 = b1.ok && Array.isArray(b1.data) && b1.data[0] ? b1.data[0].id : null;
  if (B1) created.bookings.push(B1);
  check(G.book, 'ny booking har status=active', () => Array.isArray(b1.data) && b1.data[0] && b1.data[0].status === 'active');

  // Læs tilbage
  if (B1) {
    const rb = await req('GET', `bookings?select=*&id=eq.${B1}`);
    check(G.book, 'kan læse booking tilbage', () => Array.isArray(rb.data) && rb.data.length === 1);
    eq(G.book, 'expected_km gemt', Array.isArray(rb.data) && rb.data[0] ? rb.data[0].expected_km : null, 50);
  }
  // Opdatér tider
  if (B1) {
    const ub = await req('PATCH', `bookings?id=eq.${B1}`, { end_time: '2027-03-01T14:00:00Z', expected_km: 80 });
    eq(G.book, 'opdatér bookingtider', ub.status, 200);
  }
  // Annullér (status → cancelled)
  const b2 = await req('POST', 'bookings', mkBooking({ start_time: '2027-03-02T10:00:00Z', end_time: '2027-03-02T12:00:00Z' }));
  const B2 = b2.ok && Array.isArray(b2.data) && b2.data[0] ? b2.data[0].id : null;
  if (B2) created.bookings.push(B2);
  if (B2) {
    const can = await req('PATCH', `bookings?id=eq.${B2}`, { status: 'cancelled' });
    eq(G.book, 'annullér booking (status=cancelled)', can.status, 200);
  }
  // Personlig note (migration-kolonne)
  if (B1) {
    const pn = await req('PATCH', `bookings?id=eq.${B1}`, { personal_note: 'privat note ' + RUN });
    check(G.book, 'personal_note-kolonnen findes og kan skrives', () => pn.ok);
    if (!pn.ok) finding(G.book, 'personal_note-kolonne mangler i databasen',
      `PATCH gav HTTP ${pn.status}: ${JSON.stringify(pn.data)}. Migrationen bookings_personal_note_migration.sql er måske ikke kørt.`);
  }

  // ---------- Leveringer ----------
  if (B1) {
    const d1 = await req('POST', 'deliveries', {
      booking_id: B1, car_id: CAR, start_km: 1000, end_km: 1075, duration_quarters: 8, comments: RUN,
    });
    eq(G.del, 'opret levering', d1.status, 201);
    const D1 = d1.ok && Array.isArray(d1.data) && d1.data[0] ? d1.data[0].id : null;
    if (D1) created.deliveries.push(D1);
    eq(G.del, 'km_driven beregnes (75)', Array.isArray(d1.data) && d1.data[0] ? d1.data[0].km_driven : null, 75);
  }

  // ---------- DB-constraints (negative tests) ----------
  // end_time skal være efter start_time
  const cEnd = await req('POST', 'bookings', mkBooking({ start_time: '2027-03-03T12:00:00Z', end_time: '2027-03-03T10:00:00Z' }));
  check(G.con, 'afviser slut før start (no_end_before_start)', () => !cEnd.ok);
  if (cEnd.ok && Array.isArray(cEnd.data) && cEnd.data[0]) { created.bookings.push(cEnd.data[0].id); finding(G.con, 'DB tillod slut før start', 'CHECK no_end_before_start håndhæves ikke'); }
  // end_time == start_time (skal også afvises, > ikke >=)
  const cEq = await req('POST', 'bookings', mkBooking({ start_time: '2027-03-03T10:00:00Z', end_time: '2027-03-03T10:00:00Z' }));
  check(G.con, 'afviser slut = start', () => !cEq.ok);
  if (cEq.ok && Array.isArray(cEq.data) && cEq.data[0]) created.bookings.push(cEq.data[0].id);
  // ugyldig status
  const cStat = await req('POST', 'bookings', mkBooking({ status: 'flyvsk' }));
  check(G.con, 'afviser ugyldig status-værdi', () => !cStat.ok);
  if (cStat.ok && Array.isArray(cStat.data) && cStat.data[0]) created.bookings.push(cStat.data[0].id);
  // manglende obligatorisk felt (user_name)
  const cNull = await req('POST', 'bookings', { car_id: CAR, phone: '1', start_time: '2027-03-04T10:00:00Z', end_time: '2027-03-04T12:00:00Z' });
  check(G.con, 'afviser manglende user_name (NOT NULL)', () => !cNull.ok);
  if (cNull.ok && Array.isArray(cNull.data) && cNull.data[0]) created.bookings.push(cNull.data[0].id);
  // ugyldig car_id (FK)
  const cFk = await req('POST', 'bookings', mkBooking({ car_id: '00000000-0000-0000-0000-000000000000' }));
  check(G.con, 'afviser ukendt car_id (fremmednøgle)', () => !cFk.ok);
  if (cFk.ok && Array.isArray(cFk.data) && cFk.data[0]) created.bookings.push(cFk.data[0].id);
  // levering: end_km < start_km
  const cKm = await req('POST', 'deliveries', { car_id: CAR, start_km: 500, end_km: 400, duration_quarters: 4 });
  check(G.con, 'afviser levering med end_km < start_km (positive_km)', () => !cKm.ok);
  if (cKm.ok && Array.isArray(cKm.data) && cKm.data[0]) created.deliveries.push(cKm.data[0].id);

  // ---------- Settings & sikkerhed ----------
  // admin_password må IKKE kunne indsættes/ændres med den offentlige nøgle
  const insPw = await req('POST', 'settings', { key: 'admin_password', value: 'hacked' });
  check(G.sec, 'blokerer INSERT af admin_password', () => !insPw.ok || (Array.isArray(insPw.data) && insPw.data.length === 0));
  if (insPw.ok && Array.isArray(insPw.data) && insPw.data.length) finding(G.sec, 'KRITISK: kunne indsætte admin_password', 'RLS-politik beskytter ikke admin_password mod INSERT');
  const updPw = await req('PATCH', 'settings?key=eq.admin_password', { value: 'hacked' });
  const updPwRows = Array.isArray(updPw.data) ? updPw.data.length : 0;
  check(G.sec, 'blokerer UPDATE af admin_password', () => !updPw.ok || updPwRows === 0);
  if (updPw.ok && updPwRows > 0) finding(G.sec, 'KRITISK: kunne ændre admin_password', 'RLS-politik beskytter ikke admin_password mod UPDATE');
  // en almindelig indstilling KAN skrives (upsert) og læses
  const testKey = 'zz_selftest_' + RUN;
  const upTest = await req('POST', 'settings', { key: testKey, value: '1' });
  check(G.sec, 'kan indsætte almindelig indstilling', () => upTest.ok);
  if (upTest.ok) created.settings.push(testKey);
  const upTest2 = await req('PATCH', `settings?key=eq.${testKey}`, { value: '2' });
  check(G.sec, 'kan opdatere almindelig indstilling', () => upTest2.ok);
  // Er admin_password overhovedet læsbar med offentlig nøgle? (observation)
  const pwRead = await req('GET', 'settings?select=key,value&key=eq.admin_password');
  if (pwRead.ok && Array.isArray(pwRead.data) && pwRead.data.length && pwRead.data[0].value) {
    finding(G.sec, 'admin_password er læsbar med den offentlige nøgle',
      'SELECT-politikken tillader anon at læse alle settings, inkl. admin_password-hash/-værdi. ' +
      'Overvej at flytte admin-login til en Edge Function eller begrænse SELECT på den nøgle.');
  } else {
    record(G.sec, 'admin_password ikke læsbar / ikke sat', 'PASS');
  }

  // ---------- Overlap & samtidighed ----------
  // App-lagets forhåndstjek: samme query som createBooking bruger.
  const oBase = await req('POST', 'bookings', mkBooking({ start_time: '2027-04-01T10:00:00Z', end_time: '2027-04-01T12:00:00Z' }));
  const OB = oBase.ok && Array.isArray(oBase.data) && oBase.data[0] ? oBase.data[0].id : null;
  if (OB) created.bookings.push(OB);
  const precheck = await req('GET', `bookings?select=id&car_id=eq.${CAR}&status=eq.active&start_time=lt.2027-04-01T11:30:00Z&end_time=gt.2027-04-01T10:30:00Z`);
  check(G.ov, 'app-forhåndstjek opdager overlap', () => Array.isArray(precheck.data) && precheck.data.length >= 1);
  // Anden bil på samme tid: intet overlap
  if (CAR2 && CAR2 !== CAR) {
    const pc2 = await req('GET', `bookings?select=id&car_id=eq.${CAR2}&status=eq.active&start_time=lt.2027-04-01T11:30:00Z&end_time=gt.2027-04-01T10:30:00Z`);
    check(G.ov, 'anden bil overlapper ikke i forhåndstjek', () => Array.isArray(pc2.data) && pc2.data.length === 0);
  }
  // Samtidighed: databasen har INGEN overlap-constraint. To parallelle,
  // overlappende inserts vil begge lykkes → race window i createBooking.
  const [rc1, rc2] = await Promise.all([
    req('POST', 'bookings', mkBooking({ user_name: `${RUN}_race1`, start_time: '2027-05-01T10:00:00Z', end_time: '2027-05-01T12:00:00Z' })),
    req('POST', 'bookings', mkBooking({ user_name: `${RUN}_race2`, start_time: '2027-05-01T11:00:00Z', end_time: '2027-05-01T13:00:00Z' })),
  ]);
  [rc1, rc2].forEach(r => { if (r.ok && Array.isArray(r.data) && r.data[0]) created.bookings.push(r.data[0].id); });
  const bothInserted = rc1.ok && rc2.ok;
  if (bothInserted) {
    finding(G.ov, 'Ingen DB-constraint mod dobbeltbooking (race condition)',
      'To overlappende bookinger indsat samtidigt lykkedes begge. createBooking/updateBooking laver kun ' +
      'et forhåndstjek i JS før INSERT — mellem tjek og INSERT kan en anden bruger nå at booke samme bil. ' +
      'Anbefaling: tilføj en PostgreSQL EXCLUDE-constraint (btree_gist) på (car_id WITH =, tsrange(start,end) WITH &&) ' +
      'hvor status=active, så databasen selv afviser overlap.');
  } else {
    record(G.ov, 'samtidige overlappende inserts blev afvist af databasen', 'PASS');
  }

  return { RUN, created };
}

// Sletter KUN de rækker vi selv har oprettet.
export async function cleanup(created) {
  const summary = { deliveries: 0, bookings: 0, members: 0, settings: 0, errors: [] };
  for (const id of created.deliveries) {
    const r = await req('DELETE', `deliveries?id=eq.${id}`);
    if (r.ok) summary.deliveries++; else summary.errors.push(`delivery ${id}: ${r.status}`);
  }
  for (const id of created.bookings) {
    const r = await req('DELETE', `bookings?id=eq.${id}`);
    if (r.ok) summary.bookings++; else summary.errors.push(`booking ${id}: ${r.status}`);
  }
  for (const id of created.members) {
    const r = await req('DELETE', `members?id=eq.${id}`);
    if (r.ok) summary.members++; else summary.errors.push(`member ${id}: ${r.status}`);
  }
  for (const key of created.settings) {
    const r = await req('DELETE', `settings?key=eq.${key}`);
    if (r.ok) summary.settings++; else summary.errors.push(`setting ${key}: ${r.status}`);
  }
  return summary;
}

// Efter oprydning: verificér at intet testdata er tilbage.
export async function verifyClean(RUN) {
  const leftover = {};
  const m = await req('GET', `members?select=id&navn=like.${RUN}_*`);
  leftover.members = Array.isArray(m.data) ? m.data.length : '?';
  const b = await req('GET', `bookings?select=id&notes=eq.${RUN}`);
  leftover.bookings = Array.isArray(b.data) ? b.data.length : '?';
  const s = await req('GET', `settings?select=key&key=like.zz_selftest_%`);
  leftover.settings = Array.isArray(s.data) ? s.data.length : '?';
  return leftover;
}
