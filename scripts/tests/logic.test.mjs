// Logik-tests: kører de RIGTIGE forretningsfunktioner fra app.js i en
// sandbox (uden browser/DOM) og verificerer priser, overlap, dato/uge-
// beregninger og varighedsformatering.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { check, eq, finding, extractBlock } from './harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

// Udtræk kun de rene funktioner vi vil teste (undgår al DOM-kode i app.js).
const blocks = [
  extractBlock(appSrc, 'const SETTINGS_DEFAULTS =') + ';',
  extractBlock(appSrc, 'function getSetting('),
  extractBlock(appSrc, 'function getSettingNum('),
  extractBlock(appSrc, 'function getPrices('),
  extractBlock(appSrc, 'function carPriceCategory('),
  extractBlock(appSrc, 'function calcKmCost('),
  extractBlock(appSrc, 'function calcTimeCost('),
  extractBlock(appSrc, 'function getMonday('),
  extractBlock(appSrc, 'function addDays('),
  extractBlock(appSrc, 'function roundTo15('),
  extractBlock(appSrc, 'function getISOWeek('),
  extractBlock(appSrc, 'function fmtDur('),
  extractBlock(appSrc, 'function toLocal('),
  extractBlock(appSrc, 'function bookingsOverlap('),
  extractBlock(appSrc, 'function findConflictInfo('),
];

const sandbox = {
  window: { appSettings: {} },
  state: { bookings: [] },
  console,
  Date,
  Math,
  JSON,
  parseFloat,
  parseInt,
  Number,
  String,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  blocks.join('\n') +
  '\nglobalThis.__api = { getSetting, getSettingNum, getPrices, carPriceCategory,' +
  ' calcKmCost, calcTimeCost, getMonday, addDays, roundTo15, getISOWeek, fmtDur,' +
  ' toLocal, bookingsOverlap, findConflictInfo, SETTINGS_DEFAULTS };',
  sandbox,
);
const A = sandbox.__api;

function setSettings(obj) { sandbox.window.appSettings = obj; }
function setBookings(list) { sandbox.state.bookings = list; }

// Standardpriser (fra SETTINGS_DEFAULTS) for uafhængig facit-beregning.
const D = A.SETTINGS_DEFAULTS;
const P = {
  sLow: +D.price_standard_low, sHigh: +D.price_standard_high, sThr: +D.price_standard_threshold,
  eLow: +D.price_electric_low, eHigh: +D.price_electric_high, eThr: +D.price_electric_threshold,
  hour: +D.price_hour, day: +D.price_day,
};

// Uafhængig facit for km-pris (samme spec som appen skal følge).
function expectedKm(km, cat) {
  if (!km || km <= 0) return 0;
  const t = cat === 'electric' ? { low: P.eLow, high: P.eHigh, thr: P.eThr } : { low: P.sLow, high: P.sHigh, thr: P.sThr };
  return km <= t.thr ? km * t.low : t.thr * t.low + (km - t.thr) * t.high;
}
function expectedTime(mins) {
  const hours = mins / 60;
  const fullDays = Math.floor(hours / 24);
  const rem = hours % 24;
  return fullDays * P.day + rem * P.hour;
}

export function runLogicTests() {
  setSettings({}); // brug defaults

  // ---- GRUPPE: Bilkategori ----
  const G0 = 'Bilkategori (el vs. standard)';
  const catCases = [
    ['ID3', 'standard'], ['Berlingo', 'standard'], ['Renault Zoe', 'electric'],
    ['ID Buzz', 'electric'], ['zoe', 'electric'], ['BUZZ', 'electric'],
    ['id buzz', 'electric'], ['Skoda', 'standard'], ['', 'standard'],
    ['Zoe elbil', 'electric'], ['Buzz Cargo', 'electric'], ['Berlingo Van', 'standard'],
  ];
  for (const [name, exp] of catCases) eq(G0, `kategori("${name}") = ${exp}`, A.carPriceCategory(name), exp);

  // ---- GRUPPE: Km-pris (standard) ----
  const G1 = 'Priser — km (standard)';
  for (let km = 0; km <= 260; km += 2) {
    eq(G1, `standard ${km} km`, A.calcKmCost(km, 'ID3'), expectedKm(km, 'standard'), 1e-9);
  }
  // Kanttilfælde
  eq(G1, 'standard negativ km = 0', A.calcKmCost(-50, 'ID3'), 0);
  eq(G1, 'standard km=null = 0', A.calcKmCost(null, 'ID3'), 0);
  eq(G1, 'standard netop tærskel (100)', A.calcKmCost(P.sThr, 'ID3'), P.sThr * P.sLow, 1e-9);
  eq(G1, 'standard 1 over tærskel', A.calcKmCost(P.sThr + 1, 'ID3'), P.sThr * P.sLow + P.sHigh, 1e-9);

  // ---- GRUPPE: Km-pris (el) ----
  const G2 = 'Priser — km (el)';
  for (let km = 0; km <= 260; km += 2) {
    eq(G2, `el ${km} km`, A.calcKmCost(km, 'Renault Zoe'), expectedKm(km, 'electric'), 1e-9);
  }
  eq(G2, 'el netop tærskel', A.calcKmCost(P.eThr, 'ID Buzz'), P.eThr * P.eLow, 1e-9);
  eq(G2, 'el 1 over tærskel', A.calcKmCost(P.eThr + 1, 'ID Buzz'), P.eThr * P.eLow + P.eHigh, 1e-9);
  // Km-pris skal være monotont stigende
  {
    let mono = true, bad = '';
    for (let km = 1; km <= 300; km++) {
      if (A.calcKmCost(km, 'ID3') < A.calcKmCost(km - 1, 'ID3') - 1e-9) { mono = false; bad = `${km-1}->${km}`; break; }
    }
    check(G2, 'km-pris monotont stigende (standard)' + (bad ? ` [brud ${bad}]` : ''), () => mono);
  }

  // ---- GRUPPE: Tidspris ----
  const G3 = 'Priser — tid';
  const durs = [0, 15, 30, 45, 60, 90, 120, 180, 360, 600, 720, 1380, 1439, 1440, 1441, 1500, 2160, 2820, 2880, 4320];
  for (const m of durs) eq(G3, `tidspris ${m} min`, A.calcTimeCost(m), expectedTime(m), 1e-9);
  // Monotoni-tjek: en LÆNGERE booking bør aldrig koste mindre. Prisformlen
  // (fulde døgn á dayRate + resttimer á hourRate) kan bryde dette omkring
  // døgn-grænserne — det registreres som en observation.
  {
    let firstBreak = null;
    for (let m = 1; m <= 3000; m += 1) {
      if (A.calcTimeCost(m) < A.calcTimeCost(m - 1) - 1e-9) { firstBreak = m; break; }
    }
    if (firstBreak != null) {
      const a = A.calcTimeCost(firstBreak - 1), b = A.calcTimeCost(firstBreak);
      finding(G3, 'Tidspris er IKKE monotont stigende',
        `Ved ${firstBreak - 1} min koster det ${a.toFixed(2)} kr., men ved ${firstBreak} min kun ${b.toFixed(2)} kr. ` +
        `En længere booking bliver altså billigere. Sker fordi 24 t afregnes som 1 døgn (${P.day} kr.), ` +
        `mens 23 t afregnes som 23×${P.hour}=${23*P.hour} kr. Overvej at tage min(døgn, timer×sats) pr. påbegyndt døgn.`);
    } else {
      check(G3, 'tidspris monotont stigende', () => true);
    }
  }
  // Konkret døgn-anomali
  {
    const c23 = A.calcTimeCost(23 * 60), c24 = A.calcTimeCost(24 * 60);
    if (c23 > c24) finding(G3, '23 timer dyrere end 24 timer', `23t=${c23.toFixed(2)} kr. vs 24t=${c24.toFixed(2)} kr.`);
    const c47 = A.calcTimeCost(47 * 60), c48 = A.calcTimeCost(48 * 60);
    if (c47 > c48) finding(G3, '47 timer dyrere end 48 timer', `47t=${c47.toFixed(2)} kr. vs 48t=${c48.toFixed(2)} kr.`);
  }

  // ---- GRUPPE: Priser med brugerdefinerede satser ----
  const G3b = 'Priser — brugerdefinerede satser';
  setSettings({ price_standard_low: '5', price_standard_high: '4', price_standard_threshold: '50', price_hour: '20', price_day: '200' });
  eq(G3b, 'custom: 40 km standard = 200', A.calcKmCost(40, 'ID3'), 200, 1e-9);
  eq(G3b, 'custom: 60 km standard = 50*5+10*4=290', A.calcKmCost(60, 'ID3'), 290, 1e-9);
  eq(G3b, 'custom: 5 timer = 100', A.calcTimeCost(300), 100, 1e-9);
  eq(G3b, 'custom: 24 timer = 200', A.calcTimeCost(1440), 200, 1e-9);
  setSettings({}); // nulstil

  // ---- GRUPPE: Overlap-detektion ----
  const G4 = 'Overlap-detektion';
  const CAR = 'car-A', OTHER = 'car-B';
  const base = [
    { id: '1', car_id: CAR, status: 'active', start_time: '2026-09-01T10:00:00Z', end_time: '2026-09-01T12:00:00Z' },
  ];
  const T = (h) => `2026-09-01T${String(h).padStart(2, '0')}:00:00Z`;
  const ovCases = [
    // [startH, endH, forventet overlap?, beskrivelse]
    [8, 9, false, 'før'],
    [8, 10, false, 'slutter præcis ved start (rører, ej overlap)'],
    [8, 11, true, 'overlapper start'],
    [10, 12, true, 'identisk'],
    [10.5, 11.5, true, 'inde i'],
    [9, 13, true, 'omslutter'],
    [11, 13, true, 'overlapper slut'],
    [12, 14, false, 'starter præcis ved slut (rører, ej overlap)'],
    [13, 14, false, 'efter'],
  ];
  for (const [sh, eh, exp, desc] of ovCases) {
    const s = `2026-09-01T${String(Math.floor(sh)).padStart(2,'0')}:${sh % 1 ? '30' : '00'}:00Z`;
    const e = `2026-09-01T${String(Math.floor(eh)).padStart(2,'0')}:${eh % 1 ? '30' : '00'}:00Z`;
    eq(G4, `overlap [${sh}-${eh}] (${desc})`, A.bookingsOverlap(base, CAR, s, e), exp);
  }
  eq(G4, 'anden bil overlapper ikke', A.bookingsOverlap(base, OTHER, T(10), T(12)), false);
  eq(G4, 'annulleret booking tæller ikke', A.bookingsOverlap(
    [{ id: '1', car_id: CAR, status: 'cancelled', start_time: T(10), end_time: T(12) }], CAR, T(10), T(12)), false);
  eq(G4, 'excludeId udelader egen booking', A.bookingsOverlap(base, CAR, T(10), T(12), '1'), false);
  eq(G4, 'completed booking tæller ikke', A.bookingsOverlap(
    [{ id: '9', car_id: CAR, status: 'completed', start_time: T(10), end_time: T(12) }], CAR, T(10), T(12)), false);
  // Mange overlap-permutationer mod flere eksisterende bookinger
  const many = [
    { id: 'a', car_id: CAR, status: 'active', start_time: T(6), end_time: T(8) },
    { id: 'b', car_id: CAR, status: 'active', start_time: T(9), end_time: T(11) },
    { id: 'c', car_id: CAR, status: 'active', start_time: T(14), end_time: T(16) },
  ];
  for (let sh = 5; sh <= 17; sh++) {
    for (let dur = 1; dur <= 4; dur++) {
      const eh = sh + dur;
      const exp = many.some(b => sh < +b.end_time.slice(11,13) && eh > +b.start_time.slice(11,13));
      eq(G4, `matrix start${sh} varighed${dur}`, A.bookingsOverlap(many, CAR, T(sh), T(eh)), exp);
    }
  }

  // ---- GRUPPE: findConflictInfo (næste ledige tid) ----
  const G5 = 'Konfliktinfo — næste ledige tid';
  setBookings([
    { id: 'x', car_id: CAR, status: 'active', start_time: T(10), end_time: T(12) },
    { id: 'y', car_id: CAR, status: 'active', start_time: T(12), end_time: T(14) }, // sammenhængende
    { id: 'z', car_id: CAR, status: 'active', start_time: T(15), end_time: T(16) },
  ]);
  {
    const r = A.findConflictInfo(CAR, T(11), T(13));
    check(G5, 'finder konflikt for 11-13', () => r !== null);
    eq(G5, 'næste ledige efter sammenhængende blok = 14:00', r ? new Date(r.nextFree).getUTCHours() : -1, 14);
  }
  {
    const r = A.findConflictInfo(CAR, T(8), T(9));
    eq(G5, 'ingen konflikt 8-9', r, null);
  }
  {
    const r = A.findConflictInfo(CAR, T(15), T(16), 'z');
    eq(G5, 'excludeId fjerner eneste konflikt', r, null);
  }

  // ---- GRUPPE: getMonday ----
  const G6 = 'Dato — getMonday';
  for (let offset = 0; offset < 21; offset++) {
    const d = new Date(2026, 0, 1 + offset, 13, 30, 0);
    const mon = A.getMonday(d);
    eq(G6, `getMonday(${d.toDateString()}) er mandag`, mon.getDay(), 1);
    check(G6, `getMonday(${d.toDateString()}) ikke efter input`, () => mon <= d);
    check(G6, `getMonday(${d.toDateString()}) inden for 7 dage`, () => (d - mon) < 7 * 864e5);
    eq(G6, `getMonday(${d.toDateString()}) nulstiller klokkeslæt`, mon.getHours() + mon.getMinutes(), 0);
  }

  // ---- GRUPPE: getISOWeek ----
  const G7 = 'Dato — ISO-ugenummer';
  // Høj-tillids-ankre (kendte kalenderfakta; 2026-08-31=36 er bekræftet af
  // den faktiske backup-kørsel, der loggede "uge 36").
  const isoAnchors = [
    ['2020-12-31', 53], ['2021-01-04', 1], ['2023-01-01', 52],
    ['2024-12-30', 1], ['2026-01-01', 1], ['2026-08-31', 36],
  ];
  for (const [ds, wk] of isoAnchors) {
    const [y, m, d] = ds.split('-').map(Number);
    eq(G7, `ISO-uge ${ds} = ${wk}`, A.getISOWeek(new Date(y, m - 1, d)), wk);
  }
  // Uafhængig reference-algoritme (anden formulering) sammenlignet over 6 år.
  const refISOWeek = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const ft = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const fdn = (ft.getUTCDay() + 6) % 7;
    ft.setUTCDate(ft.getUTCDate() - fdn + 3);
    return 1 + Math.round((d - ft) / (7 * 864e5));
  };
  let isoMismatch = null;
  for (let t = Date.UTC(2022, 0, 1); t <= Date.UTC(2027, 11, 31); t += 864e5) {
    const dt = new Date(t);
    if (A.getISOWeek(dt) !== refISOWeek(dt)) { isoMismatch = dt.toISOString().slice(0, 10); break; }
  }
  check(G7, 'getISOWeek matcher reference-algoritme over 2022–2027' + (isoMismatch ? ` [afviger ${isoMismatch}]` : ''), () => isoMismatch === null);

  // ---- GRUPPE: roundTo15 ----
  const G8 = 'Dato — roundTo15';
  for (let m = 0; m < 60; m++) {
    const d = new Date(2026, 5, 15, 10, m, 33);
    const r = A.roundTo15(d);
    check(G8, `roundTo15 min=${m} → kvarter`, () => [0, 15, 30, 45].includes(r.getMinutes()));
    eq(G8, `roundTo15 min=${m} nulstiller sekunder`, r.getSeconds(), 0);
    eq(G8, `roundTo15 min=${m} korrekt`, r.getMinutes(), Math.round(m / 15) * 15 % 60);
  }

  // ---- GRUPPE: fmtDur ----
  const G9 = 'Format — varighed (H:MM)';
  const durCases = [[0, '0:00'], [5, '0:05'], [59, '0:59'], [60, '1:00'], [90, '1:30'],
    [125, '2:05'], [600, '10:00'], [1440, '24:00'], [1445, '24:05'], [61, '1:01']];
  for (const [m, s] of durCases) eq(G9, `fmtDur(${m}) = "${s}"`, A.fmtDur(m), s);

  // ---- GRUPPE: addDays ----
  const G10 = 'Dato — addDays';
  eq(G10, 'addDays +1 over månedsskifte', A.addDays(new Date(2026, 0, 31, 12), 1).getMonth(), 1);
  eq(G10, 'addDays +1 over månedsskifte (dag)', A.addDays(new Date(2026, 0, 31, 12), 1).getDate(), 1);
  eq(G10, 'addDays -1 over årsskifte (år)', A.addDays(new Date(2026, 0, 1, 12), -1).getFullYear(), 2025);
  eq(G10, 'addDays +365 (skudår 2028 → 366)', A.addDays(new Date(2028, 0, 1, 12), 366).getFullYear(), 2029);
  eq(G10, 'addDays ændrer ikke original', (() => { const o = new Date(2026, 0, 1); A.addDays(o, 5); return o.getDate(); })(), 1);
}
