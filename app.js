// =============================================
// CONFIG
// =============================================
const SUPABASE_URL = 'https://fdwiooogkophykysbbrh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TEUUw-SUTC_XyQ3aNK1VKg_s9A8WAf4';
const ADMIN_PASSWORD = 'bilklub2024';
const DAY_START_H  = 0;
const DAY_END_H    = 24;
const DAY_MINUTES  = (DAY_END_H - DAY_START_H) * 60; // 1440
const PX_PER_MIN   = 1; // 1 px pr. minut → kolonnehøjde = 960 px

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// =============================================
// STATE
// =============================================
const state = {
  cars: [],
  bookings: [],
  enabledCars: new Set(),
  weekStart:     getMonday(new Date()),
  selectedDay:   (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })(),
  currentMonth:  (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })(),
  viewMode:      'week',       // 'day' | 'week' | 'month'
  currentView:   'calendar',
  adminUnlocked: false,
  editingBookingId: null,      // null = ny booking, string = redigering
};

// =============================================
// UTILS
// =============================================
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDayNum(date) {
  return new Date(date).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
}

function fmtWeekday(date) {
  return new Date(date).toLocaleDateString('da-DK', { weekday: 'long' });
}

function fmtWeekdayShort(date) {
  return new Date(date).toLocaleDateString('da-DK', { weekday: 'short' });
}

function fmtTime(date) {
  return new Date(date).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
}

function fmtDur(totalMins) {
  const h = Math.floor(totalMins / 60);
  const m = Math.round(totalMins % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function fmtShortDate(date) {
  const d = new Date(date);
  return `${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function fmtDateTime(date) {
  return new Date(date).toLocaleDateString('da-DK', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function toLocal(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function roundTo15(date) {
  const d = new Date(date);
  d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

// Fyld et <select>-element med tidsintervaller á 15 min (00:00 – 23:45)
function buildTimeSelect(id) {
  const sel = document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const v = `${pad(h)}:${pad(m)}`;
      const opt = document.createElement('option');
      opt.value = opt.textContent = v;
      sel.appendChild(opt);
    }
  }
}
['bm-start-time', 'bm-end-time', 'dlm-end-time'].forEach(buildTimeSelect);

// Sæt dato+tid-inputs fra et Date-objekt (local time)
function setDT(dateId, timeId, date) {
  const local = toLocal(new Date(date)); // "YYYY-MM-DDTHH:MM" i lokaltid
  document.getElementById(dateId).value = local.slice(0, 10);
  const totalMins = parseInt(local.slice(11, 13)) * 60 + parseInt(local.slice(14, 16));
  const snapped = Math.round(totalMins / 15) * 15;
  const sh = Math.floor(snapped / 60) % 24;
  const sm = snapped % 60;
  const pad = n => String(n).padStart(2, '0');
  document.getElementById(timeId).value = `${pad(sh)}:${pad(sm)}`;
}

// Læs Date fra dato+tid-inputs (local time)
function getDT(dateId, timeId) {
  const d = document.getElementById(dateId).value;
  const t = document.getElementById(timeId).value;
  if (!d || !t) return null;
  return new Date(`${d}T${t}`);
}

// Finder konflikter og næste ledige tidspunkt for en bil
function findConflictInfo(carId, startTime, endTime, excludeId = null) {
  const s = new Date(startTime);
  const e = new Date(endTime);

  const conflicts = state.bookings
    .filter(b =>
      b.car_id === carId && b.status === 'active' &&
      (!excludeId || b.id !== excludeId) &&
      new Date(b.start_time) < e && new Date(b.end_time) > s
    )
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  if (!conflicts.length) return null;

  const first = conflicts[0];

  // Rykker "ledig fra" fremad så længe der er sammenhængende bookinger
  let nextFree = new Date(first.end_time);
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of state.bookings) {
      if (b.car_id !== carId || b.status !== 'active') continue;
      if (excludeId && b.id === excludeId) continue;
      const bs = new Date(b.start_time), be = new Date(b.end_time);
      if (bs <= nextFree && be > nextFree) { nextFree = be; changed = true; }
    }
  }

  return { first, nextFree };
}

function cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// =============================================
// TOAST
// =============================================
function toast(msg, type = 'info', duration = 3500) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// =============================================
// DB FUNCTIONS
// =============================================
async function loadCars() {
  const { data, error } = await db.from('cars').select('*').eq('active', true).order('name');
  if (error) throw error;
  state.cars = data;
  if (state.enabledCars.size === 0) data.forEach(c => state.enabledCars.add(c.id));
}

async function loadBookingsForCurrentView() {
  let from, to;
  if (state.viewMode === 'day') {
    from = addDays(state.selectedDay, -1);
    to   = addDays(state.selectedDay, 2);
  } else if (state.viewMode === 'week') {
    from = addDays(state.weekStart, -1);
    to   = addDays(state.weekStart, 8);
  } else {
    const y = state.currentMonth.getFullYear(), m = state.currentMonth.getMonth();
    from = getMonday(new Date(y, m, 1));
    to   = addDays(new Date(y, m + 1, 0), 7);
  }
  await loadBookings(from, to);
}

async function loadBookings(from, to) {
  const { data, error } = await db
    .from('bookings')
    .select('*, cars(name, color)')
    .gte('end_time',   from.toISOString())
    .lte('start_time', to.toISOString())
    .in('status', ['active', 'completed'])
    .order('start_time');
  if (error) throw error;
  state.bookings = data;
}


async function logActivity(actionType, carId, bookingId, userName, details) {
  const { error } = await db.from('activity_log').insert({
    action_type: actionType,
    car_id:      carId     || null,
    booking_id:  bookingId || null,
    user_name:   userName  || null,
    details:     details   || {},
  });
  if (error) console.error('Log error:', error);
}

function bookingsOverlap(existingBookings, carId, startTime, endTime, excludeId = null) {
  const s = new Date(startTime), e = new Date(endTime);
  return existingBookings.some(b => {
    if (b.car_id !== carId || b.status !== 'active') return false;
    if (excludeId && b.id === excludeId) return false;
    return s < new Date(b.end_time) && e > new Date(b.start_time);
  });
}

async function createBooking(data) {
  const { data: existing } = await db
    .from('bookings').select('id')
    .eq('car_id', data.car_id).eq('status', 'active')
    .lt('start_time', data.end_time).gt('end_time', data.start_time);

  if (existing && existing.length > 0)
    throw new Error('Bilen er allerede booket i dette tidsrum — dobbelttjekket mod databasen.');

  const { data: created, error } = await db.from('bookings').insert(data).select().single();
  if (error) throw error;

  await logActivity('booking_oprettet', data.car_id, created.id, data.user_name, {
    start_time: data.start_time, end_time: data.end_time,
    expected_km: data.expected_km, start_km: data.start_km,
  });
  return created;
}

async function updateBooking(bookingId, data) {
  const { data: existing } = await db
    .from('bookings').select('id')
    .eq('car_id', data.car_id).eq('status', 'active')
    .neq('id', bookingId)
    .lt('start_time', data.end_time).gt('end_time', data.start_time);

  if (existing && existing.length > 0)
    throw new Error('Bilen er allerede booket i dette tidsrum.');

  const { error } = await db.from('bookings').update({
    user_name: data.user_name, phone: data.phone,
    expected_km: data.expected_km, start_km: data.start_km,
    start_time: data.start_time, end_time: data.end_time, notes: data.notes,
  }).eq('id', bookingId);
  if (error) throw error;

  await logActivity('booking_aendret', data.car_id, bookingId, data.user_name, {
    start_time: data.start_time, end_time: data.end_time,
    expected_km: data.expected_km, start_km: data.start_km,
  });
}

async function cancelBooking(bookingId) {
  const booking = state.bookings.find(b => b.id === bookingId)
    || (await db.from('bookings').select('*').eq('id', bookingId).single()).data;

  const { error } = await db.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId);
  if (error) throw error;

  await logActivity('booking_annulleret', booking.car_id, bookingId, booking.user_name, {
    start_time: booking.start_time, end_time: booking.end_time,
  });
}

// =============================================
// CALENDAR — CAR TOGGLES & NAVIGATION LABEL
// =============================================
function renderCarToggles() {
  const container = document.getElementById('car-toggles');
  container.innerHTML = state.cars.map(car => `
    <button class="toggle-btn ${state.enabledCars.has(car.id) ? 'on' : 'off'}"
      data-car-id="${car.id}"
      style="border-color:${car.color};color:${car.color}">
      <span class="dot" style="background:${car.color}"></span>
      ${car.name}
    </button>`).join('');

  container.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.carId;
      if (state.enabledCars.has(id)) { state.enabledCars.delete(id); btn.classList.replace('on','off'); }
      else                            { state.enabledCars.add(id);    btn.classList.replace('off','on'); }
      renderCalendarGrid();
    });
  });
}

function renderNavLabel() {
  const el = document.getElementById('week-label');
  if (state.viewMode === 'day') {
    el.textContent = cap(fmtWeekday(state.selectedDay)) + ', ' + fmtDayNum(state.selectedDay);
  } else if (state.viewMode === 'week') {
    const end = addDays(state.weekStart, 6);
    el.textContent = `${fmtDayNum(state.weekStart)} – ${fmtDayNum(end)} ${state.weekStart.getFullYear()}`;
  } else {
    el.textContent = cap(state.currentMonth.toLocaleDateString('da-DK', { month: 'long', year: 'numeric' }));
  }
}

// =============================================
// CALENDAR — MAIN RENDERING
// =============================================
function renderCalendar() {
  renderCarToggles();
  renderNavLabel();
  renderCalendarGrid();
}

function renderCalendarGrid() {
  const grid = document.getElementById('calendar-grid');
  const enabledCars = state.cars.filter(c => state.enabledCars.has(c.id));

  if (enabledCars.length === 0) {
    grid.innerHTML = `<div class="empty-cal">Slå mindst én bil til for at se kalenderen.</div>`;
    return;
  }

  if (state.viewMode === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
    grid.innerHTML = buildTimeline(days, enabledCars);
  } else if (state.viewMode === 'day') {
    grid.innerHTML = buildTimeline([state.selectedDay], enabledCars);
  } else {
    grid.innerHTML = buildMonthView(enabledCars);
  }

  attachCalendarEvents(enabledCars);
}

// =============================================
// CALENDAR — TIMELINE (day & week views)
// =============================================
function buildTimeline(days, enabledCars) {
  const today = new Date(); today.setHours(0,0,0,0);

  // Car legend
  const legend = `
    <div class="car-legend">
      ${enabledCars.map(c => `
        <span class="legend-item">
          <span class="legend-dot" style="background:${c.color}"></span>${c.name}
        </span>`).join('')}
    </div>`;

  // Header: day names
  const headerCells = days.map(day => {
    const isToday = day.toDateString() === today.toDateString();
    return `
      <div class="cal-head-cell${isToday ? ' today' : ''}" data-date="${day.toISOString()}">
        <div class="head-wd">${cap(fmtWeekdayShort(day))}</div>
        <div class="head-num${isToday ? ' is-today' : ''}">${day.getDate()}</div>
        <div class="head-mo">${day.toLocaleDateString('da-DK',{month:'short'})}</div>
      </div>`;
  }).join('');

  // Time labels (left column)
  const timeLabels = Array.from({ length: DAY_END_H - DAY_START_H + 1 }, (_, i) => {
    const h = DAY_START_H + i;
    return `<div class="time-lbl" style="top:${i * 60}px">${String(h).padStart(2,'0')}:00</div>`;
  }).join('');

  // Day columns
  const dayCols = days.map(day => buildDayCol(day, enabledCars)).join('');

  return `
    ${legend}
    <div class="cal-header-row">
      <div class="cal-time-spacer"></div>
      <div class="cal-head-cells" style="--num-days:${days.length}">${headerCells}</div>
    </div>
    <div class="cal-body">
      <div class="cal-time-col">${timeLabels}</div>
      <div class="cal-days-wrap" style="--num-days:${days.length}">${dayCols}</div>
    </div>`;
}

function buildDayCol(day, enabledCars) {
  const today = new Date(); today.setHours(0,0,0,0);
  const isPast    = day < today;
  const dayStart  = new Date(day); dayStart.setHours(0,0,0,0);
  const dayEnd    = new Date(day); dayEnd.setHours(23,59,59,999);

  // Grid lines
  const lines = Array.from({ length: DAY_END_H - DAY_START_H + 1 }, (_, i) =>
    `<div class="hour-line" style="top:${i*60}px"></div>`
  ).join('') +
  Array.from({ length: DAY_END_H - DAY_START_H }, (_, i) =>
    `<div class="half-line" style="top:${i*60+30}px"></div>`
  ).join('');

  // Bookings for this day, alle aktiverede biler
  const dayBookings = state.bookings.filter(b =>
    enabledCars.some(c => c.id === b.car_id) &&
    new Date(b.start_time) < dayEnd &&
    new Date(b.end_time) > dayStart
  );

  const blocks = dayBookings.map(b => {
    const car = enabledCars.find(c => c.id === b.car_id);
    if (!car) return '';

    const bStart     = new Date(b.start_time);
    const bEnd       = new Date(b.end_time);
    const startsHere = bStart >= dayStart;
    const endsHere   = bEnd   <= dayEnd;

    // Clip top/bottom to this day's boundaries for multi-day bookings
    const clampS = startsHere ? bStart.getHours()*60 + bStart.getMinutes() - DAY_START_H*60 : 0;
    const clampE = endsHere   ? bEnd.getHours()*60   + bEnd.getMinutes()   - DAY_START_H*60 : DAY_MINUTES;
    const h      = Math.max(clampE - clampS, 18);

    const carIdx = enabledCars.findIndex(c => c.id === b.car_id);
    const total  = enabledCars.length;
    const lPct   = (carIdx / total) * 100;
    const wPct   = 100 / total;

    // Visual span markers: dashed edge where the booking bleeds into another day
    let spanCls = '';
    if (!startsHere) spanCls += ' span-closed';
    if (!endsHere)   spanCls += ' span-open';

    // Time label — for multi-day show the actual start/end date so it's clear
    let timeLabel = '';
    if (h >= 28) {
      if (startsHere && endsHere) {
        timeLabel = `<span class="bb-time">${fmtTime(bStart)}–${fmtTime(bEnd)}</span>`;
      } else if (startsHere) {
        timeLabel = `<span class="bb-time">${fmtTime(bStart)} &#9658; ${fmtShortDate(bEnd)}</span>`;
      } else if (endsHere) {
        timeLabel = `<span class="bb-time">&#9668; ${fmtShortDate(bStart)} – ${fmtTime(bEnd)}</span>`;
      } else {
        timeLabel = `<span class="bb-time">&#9668; hele dagen &#9658;</span>`;
      }
    }

    const isCompleted = b.status === 'completed';
    const durLabel = isCompleted && h >= 28
      ? `<span class="bb-dur">${fmtDur(Math.round((bEnd - bStart) / 60000))}</span>` : '';
    return `
      <div class="booking-block${isCompleted ? ' completed' : ''}${spanCls}"
        style="top:${clampS}px;height:${h}px;left:calc(${lPct}% + 1px);width:calc(${wPct}% - 2px);${isCompleted ? '' : `background:${car.color};`}"
        data-booking-id="${b.id}">
        <span class="bb-name">${b.user_name}</span>
        ${timeLabel}
        ${durLabel}
        ${h >= 52 ? `<span class="bb-car">${car.name}</span>` : ''}
      </div>`;
  }).join('');

  // Current time line (today only)
  let nowLine = '';
  if (day.toDateString() === today.toDateString()) {
    const now = new Date();
    const nowMin = (now.getHours()*60 + now.getMinutes()) - DAY_START_H*60;
    if (nowMin > 0 && nowMin < DAY_MINUTES) {
      nowLine = `<div class="now-line" style="top:${nowMin}px"></div>`;
    }
  }

  return `
    <div class="day-col${isPast ? ' past' : ''}" style="height:${DAY_MINUTES}px" data-date="${day.toISOString()}">
      ${lines}${nowLine}${blocks}
      ${!isPast ? '<div class="click-hint">+</div>' : ''}
    </div>`;
}

// =============================================
// CALENDAR — MONTH VIEW
// =============================================
function buildMonthView(enabledCars) {
  const y = state.currentMonth.getFullYear();
  const m = state.currentMonth.getMonth();
  const weeks  = getMonthWeeks(y, m);
  const today  = new Date(); today.setHours(0,0,0,0);
  const dayNames = ['Ma','Ti','On','To','Fr','Lø','Sø'];

  const header = dayNames.map(d => `<div class="month-head">${d}</div>`).join('');

  const cells = weeks.flatMap(week =>
    week.map(day => {
      const inMonth  = day.getMonth() === m;
      const isToday  = day.toDateString() === today.toDateString();
      const isPast   = day < today;
      const dStart   = new Date(day); dStart.setHours(0,0,0,0);
      const dEnd     = new Date(day); dEnd.setHours(23,59,59,999);

      const bkgs = state.bookings.filter(b =>
        enabledCars.some(c => c.id === b.car_id) &&
        new Date(b.start_time) < dEnd && new Date(b.end_time) > dStart
      );

      const bars = bkgs.slice(0,3).map(b => {
        const car = enabledCars.find(c => c.id === b.car_id);
        return `<div class="month-event" style="background:${car?.color}">${car?.name}: ${b.user_name}</div>`;
      }).join('');
      const more = bkgs.length > 3 ? `<div class="month-more">+${bkgs.length-3}</div>` : '';

      return `
        <div class="month-cell${!inMonth ? ' other-month' : ''}${isToday ? ' today' : ''}${isPast ? ' past' : ''}"
          data-date="${day.toISOString()}">
          <div class="month-day-num${isToday ? ' is-today' : ''}">${day.getDate()}</div>
          <div class="month-events">${bars}${more}</div>
        </div>`;
    })
  ).join('');

  return `<div class="month-grid">${header}${cells}</div>`;
}

function getMonthWeeks(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const start    = getMonday(firstDay);
  const weeks    = [];
  const cur      = new Date(start);
  do {
    weeks.push(Array.from({length:7}, () => { const d = new Date(cur); cur.setDate(cur.getDate()+1); return d; }));
  } while (cur <= lastDay);
  return weeks;
}

// =============================================
// CALENDAR — EVENT LISTENERS
// =============================================
function attachCalendarEvents(enabledCars) {
  // Klik på booking (aktiv eller afleveret) → detaljevisning
  document.querySelectorAll('.booking-block').forEach(block => {
    block.addEventListener('click', e => {
      e.stopPropagation();
      openDetailModal(block.dataset.bookingId);
    });
  });

  // Klik på fri plads i dagkolonne → booking-modal
  document.querySelectorAll('.day-col:not(.past)').forEach(col => {
    col.addEventListener('click', e => {
      if (e.target.closest('.booking-block')) return;
      const day  = new Date(col.dataset.date);
      const rect = col.getBoundingClientRect();
      const y    = e.clientY - rect.top;
      const mins = Math.round((y / DAY_MINUTES) * DAY_MINUTES / 15) * 15;
      const tot  = DAY_START_H * 60 + Math.max(0, Math.min(mins, DAY_MINUTES - 30));
      day.setHours(Math.floor(tot/60), tot%60, 0, 0);

      // Hvilken bil? Ud fra X-position indenfor kolonnens bredde
      const x      = e.clientX - rect.left;
      const carIdx = Math.max(0, Math.min(Math.floor((x / rect.width) * enabledCars.length), enabledCars.length - 1));
      openBookingModal(enabledCars[carIdx].id, day);
    });
  });

  // Månedvisning: klik på dag → dagvisning
  document.querySelectorAll('.month-cell:not(.other-month)').forEach(cell => {
    cell.addEventListener('click', () => {
      state.selectedDay = new Date(cell.dataset.date);
      state.selectedDay.setHours(0,0,0,0);
      setViewMode('day');
    });
  });
}

// =============================================
// VIEW MODE SWITCHER
// =============================================
function setViewMode(mode) {
  state.viewMode = mode;
  if (mode === 'week') state.weekStart = getMonday(state.selectedDay);
  if (mode === 'month') state.currentMonth = new Date(state.selectedDay.getFullYear(), state.selectedDay.getMonth(), 1);

  document.querySelectorAll('.view-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));

  loadBookingsForCurrentView().then(() => {
    renderNavLabel();
    renderCalendarGrid();
  });
}

document.querySelectorAll('.view-mode-btn').forEach(btn =>
  btn.addEventListener('click', () => setViewMode(btn.dataset.mode)));

// =============================================
// BOOKING MODAL — OPRET & REDIGER
// =============================================
function openBookingModal(carId, suggestedStart, editingBooking = null) {
  const car = state.cars.find(c => c.id === carId);
  if (!car) return;

  state.editingBookingId = editingBooking ? editingBooking.id : null;

  const suggestedEnd = new Date(suggestedStart);
  suggestedEnd.setHours(suggestedEnd.getHours() + 1);

  const selectorWrap  = document.getElementById('bm-car-selector-wrap');
  const badgeWrap     = document.getElementById('bm-car-badge-wrap');

  if (editingBooking) {
    // Ved redigering: vis fast badge, ingen vælger
    selectorWrap.classList.add('hidden');
    badgeWrap.classList.remove('hidden');
    document.getElementById('bm-car-badge').textContent = car.name;
    document.getElementById('bm-car-badge').style.background = car.color;
    document.getElementById('bm-car-id').value = carId;
  } else {
    // Ny booking: vis vælger med alle aktiverede biler
    selectorWrap.classList.remove('hidden');
    badgeWrap.classList.add('hidden');

    const enabledCars = state.cars.filter(c => state.enabledCars.has(c.id));
    const selector = document.getElementById('bm-car-selector');
    selector.innerHTML = enabledCars.map(c => `
      <button type="button" class="car-select-btn${c.id === carId ? ' selected' : ''}"
        data-car-id="${c.id}" style="background:${c.color}">
        ${c.name}
      </button>`).join('');

    document.getElementById('bm-car-id').value = carId;

    selector.querySelectorAll('.car-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selector.querySelectorAll('.car-select-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        const selectedId  = btn.dataset.carId;
        const selectedCar = state.cars.find(c => c.id === selectedId);
        document.getElementById('bm-car-id').value = selectedId;
        // Opdater start-km til den valgte bils seneste km-stand
        if (selectedCar) {
          document.getElementById('bm-start-km').value = selectedCar.current_km || 0;
        }
      });
    });
  }

  document.getElementById('bm-start-km').value = car.current_km || 0;

  setDT('bm-start-date', 'bm-start-time', editingBooking ? new Date(editingBooking.start_time) : roundTo15(suggestedStart));
  setDT('bm-end-date',   'bm-end-time',   editingBooking ? new Date(editingBooking.end_time)   : roundTo15(suggestedEnd));
  document.getElementById('bm-name').value    = editingBooking ? editingBooking.user_name : '';
  document.getElementById('bm-phone').value   = editingBooking ? editingBooking.phone     : '';
  document.getElementById('bm-exp-km').value  = editingBooking ? editingBooking.expected_km : '';
  document.getElementById('bm-notes').value   = editingBooking ? (editingBooking.notes || '') : '';

  document.getElementById('bm-submit').textContent = editingBooking ? 'Gem ændringer' : 'Book bil';
  document.getElementById('bm-modal-title').textContent = editingBooking ? 'Rediger booking' : 'Ny booking';

  showError('bm-error', '');
  document.getElementById('booking-modal').classList.remove('hidden');
  document.getElementById('bm-name').focus();
}


function onStartChange() {
  const start = getDT('bm-start-date', 'bm-start-time');
  if (!start) return;
  const end = getDT('bm-end-date', 'bm-end-time');
  if (!end || end <= start) {
    const newEnd = new Date(start);
    newEnd.setHours(newEnd.getHours() + 1);
    setDT('bm-end-date', 'bm-end-time', newEnd);
  }
}
['bm-start-date', 'bm-start-time'].forEach(id =>
  document.getElementById(id).addEventListener('change', onStartChange));

function closeBookingModal() {
  document.getElementById('booking-modal').classList.add('hidden');
  state.editingBookingId = null;
}
document.getElementById('bm-close').addEventListener('click', closeBookingModal);
document.getElementById('bm-cancel').addEventListener('click', closeBookingModal);

document.getElementById('bm-submit').addEventListener('click', async () => {
  const carId    = document.getElementById('bm-car-id').value;
  const name     = document.getElementById('bm-name').value.trim();
  const phone    = document.getElementById('bm-phone').value.trim();
  const expKm    = parseInt(document.getElementById('bm-exp-km').value, 10);
  const startKm  = parseInt(document.getElementById('bm-start-km').value, 10);
  const notes    = document.getElementById('bm-notes').value.trim();

  if (!name)   return showError('bm-error', 'Indtast dit navn.');
  if (!phone)  return showError('bm-error', 'Indtast dit telefonnummer.');
  if (!expKm || expKm < 0) return showError('bm-error', 'Forventet km skal være større end 0.');

  const startTime = getDT('bm-start-date', 'bm-start-time');
  const endTime   = getDT('bm-end-date', 'bm-end-time');
  if (!startTime || !endTime) return showError('bm-error', 'Vælg start- og sluttidspunkt.');

  if (endTime <= startTime) return showError('bm-error', 'Sluttidspunkt skal være efter starttidspunkt.');
  if (!state.adminUnlocked && !state.editingBookingId && startTime < new Date(Date.now() - 15 * 60 * 1000))
    return showError('bm-error', 'Du kan ikke booke mere end 15 minutter tilbage i tiden.');

  const conflict = findConflictInfo(carId, startTime.toISOString(), endTime.toISOString(), state.editingBookingId);
  if (conflict) {
    const { first, nextFree } = conflict;
    const el = document.getElementById('bm-error');
    el.innerHTML =
      `Bilen er optaget <strong>${fmtDateTime(first.start_time)} – ${fmtTime(first.end_time)}</strong>` +
      ` (booket af ${first.user_name}).<br>` +
      `<strong>Ledig fra: ${fmtDateTime(nextFree)}</strong>`;
    el.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('bm-submit');
  btn.disabled = true;

  try {
    const bookingData = {
      car_id: carId, user_name: name, phone,
      expected_km: expKm, start_km: startKm,
      start_time: startTime.toISOString(), end_time: endTime.toISOString(), notes,
    };

    if (state.editingBookingId) {
      await updateBooking(state.editingBookingId, bookingData);
      toast('Booking opdateret', 'success');
    } else {
      const created = await createBooking(bookingData);
      toast(`Booking oprettet for ${state.cars.find(c=>c.id===carId)?.name}`, 'success');
    }

    closeBookingModal();
    await loadBookingsForCurrentView();
    renderCalendarGrid();
    if (state.adminUnlocked) loadAllBookingsAdmin();
  } catch (err) {
    showError('bm-error', err.message || 'Fejl — prøv igen.');
  } finally {
    btn.disabled = false;
    btn.textContent = state.editingBookingId ? 'Gem ændringer' : 'Book bil';
  }
});

// =============================================
// DETAIL MODAL
// =============================================
async function openDetailModal(bookingId) {
  let b = state.bookings.find(x => x.id === bookingId);
  if (!b) {
    const res = await db.from('bookings').select('*, cars(name,color)').eq('id', bookingId).single();
    b = res.data;
  }
  if (!b) return;
  const car = b.cars || state.cars.find(c => c.id === b.car_id);

  const isActive = b.status === 'active';
  let deliveryHtml = '';
  if (!isActive) {
    const { data: del } = await db.from('deliveries').select('*').eq('booking_id', bookingId).maybeSingle();
    if (del) {
      deliveryHtml = `
        <div class="dm-row"><label>Afleveret</label><span>${fmtDateTime(del.created_at)}</span></div>
        <div class="dm-row"><label>Km kørt</label><span>${del.km_driven?.toLocaleString('da-DK')} km</span></div>
        <div class="dm-row"><label>Km-stand ved aflevering</label><span>${del.end_km?.toLocaleString('da-DK')} km</span></div>
        ${del.comments ? `<div class="dm-row"><label>Kommentar</label><span>${del.comments}</span></div>` : ''}
      `;
    }
  }

  document.getElementById('dm-content').innerHTML = `
    <div style="margin-bottom:14px">
      <span class="car-badge" style="background:${car?.color}">${car?.name}</span>
    </div>
    <div class="dm-row"><label>Booket af</label><span>${b.user_name}</span></div>
    <div class="dm-row"><label>Telefon</label><span>${b.phone}</span></div>
    <div class="dm-row"><label>Periode</label><span>${fmtDateTime(b.start_time)} → ${fmtDateTime(b.end_time)}</span></div>
    <div class="dm-row"><label>Tidsrum</label><span>${fmtDur(Math.round((new Date(b.end_time) - new Date(b.start_time)) / 60000))}</span></div>
    <div class="dm-row"><label>Forventet km</label><span>${b.expected_km} km</span></div>
    ${deliveryHtml}
    ${b.notes ? `<div class="dm-row"><label>Bemærkninger</label><span>${b.notes}</span></div>` : ''}
    <div class="dm-row"><label>Oprettet</label><span>${fmtDateTime(b.created_at)}</span></div>
  `;

  document.getElementById('dm-edit-btn').dataset.bookingId = bookingId;
  document.getElementById('dm-cancel-booking').dataset.bookingId = bookingId;
  document.getElementById('dm-deliver-btn').dataset.bookingId = bookingId;

  const now        = new Date();
  const hasStarted = now >= new Date(b.start_time);
  const hasExpired = now > new Date(b.end_time);
  const canDeliver = state.adminUnlocked || hasStarted || hasExpired;

  const deliverBtn = document.getElementById('dm-deliver-btn');
  const editBtn    = document.getElementById('dm-edit-btn');
  const cancelBtn  = document.getElementById('dm-cancel-booking');

  deliverBtn.classList.toggle('hidden', !isActive);
  editBtn.classList.remove('hidden');
  cancelBtn.classList.toggle('hidden', !isActive);

  deliverBtn.disabled = !canDeliver;
  deliverBtn.title = canDeliver ? '' : `Bookingen starter ${fmtDateTime(b.start_time)} — kan først afleveres da`;

  document.getElementById('detail-modal').classList.remove('hidden');
}

document.getElementById('dm-close').addEventListener('click', () =>
  document.getElementById('detail-modal').classList.add('hidden'));
document.getElementById('dm-close-btn').addEventListener('click', () =>
  document.getElementById('detail-modal').classList.add('hidden'));

document.getElementById('dm-edit-btn').addEventListener('click', async function () {
  const bookingId = this.dataset.bookingId;
  if (!confirm('Vil du ændre bookingen?')) return;

  document.getElementById('detail-modal').classList.add('hidden');

  let b = state.bookings.find(x => x.id === bookingId);
  if (!b) {
    const res = await db.from('bookings').select('*').eq('id', bookingId).single();
    b = res.data;
  }
  if (!b) return;

  openBookingModal(b.car_id, new Date(b.start_time), b);
});

document.getElementById('dm-cancel-booking').addEventListener('click', async function () {
  if (!confirm('Er du sikker på, at du vil annullere denne booking?')) return;
  try {
    await cancelBooking(this.dataset.bookingId);
    document.getElementById('detail-modal').classList.add('hidden');
    toast('Booking annulleret', 'info');
    await loadBookingsForCurrentView();
    renderCalendarGrid();
  } catch (err) {
    toast('Fejl: ' + err.message, 'error');
  }
});

document.getElementById('dm-deliver-btn').addEventListener('click', function () {
  openDeliveryModal(this.dataset.bookingId);
});

// =============================================
// DELIVERY MODAL
// =============================================
let deliveryBookingId = null;

function openDeliveryModal(bookingId) {
  const b   = state.bookings.find(x => x.id === bookingId);
  if (!b) return;
  const car = state.cars.find(c => c.id === b.car_id);

  deliveryBookingId = bookingId;

  const badge = document.getElementById('dlm-car-badge');
  badge.textContent  = car?.name || '';
  badge.style.background = car?.color || '#666';

  document.getElementById('dlm-booking-info').innerHTML =
    `<strong>${b.user_name}</strong> &mdash; ${b.phone}<br>` +
    `${fmtDateTime(b.start_time)} → ${fmtDateTime(b.end_time)}<br>` +
    `Forventet: ${b.expected_km} km`;

  // Default end time: now rounded to 15 min
  setDT('dlm-end-date', 'dlm-end-time', roundTo15(new Date()));
  document.getElementById('dlm-start-km').value = car?.current_km || 0;
  document.getElementById('dlm-end-km').value   = '';
  document.getElementById('dlm-km-driven').value = '';
  document.getElementById('dlm-comments').value  = '';
  showError('dlm-error', '');

  document.getElementById('detail-modal').classList.add('hidden');
  document.getElementById('delivery-modal').classList.remove('hidden');
  document.getElementById('dlm-end-km').focus();
}

document.getElementById('dlm-end-km').addEventListener('input', function () {
  const startKm = parseInt(document.getElementById('dlm-start-km').value, 10);
  const endKm   = parseInt(this.value, 10);
  document.getElementById('dlm-km-driven').value =
    (!isNaN(startKm) && !isNaN(endKm) && endKm >= startKm) ? endKm - startKm : '';
});

function closeDeliveryModal() {
  document.getElementById('delivery-modal').classList.add('hidden');
  deliveryBookingId = null;
}
document.getElementById('dlm-close').addEventListener('click', closeDeliveryModal);
document.getElementById('dlm-cancel').addEventListener('click', closeDeliveryModal);

document.getElementById('dlm-submit').addEventListener('click', async () => {
  const b       = state.bookings.find(x => x.id === deliveryBookingId);
  if (!b) return;
  const car     = state.cars.find(c => c.id === b.car_id);
  const startKm = car?.current_km || 0;
  const endKm   = parseInt(document.getElementById('dlm-end-km').value, 10);
  const endTime = getDT('dlm-end-date', 'dlm-end-time');
  const comments   = document.getElementById('dlm-comments').value.trim();

  if (!endTime)               return showError('dlm-error', 'Vælg afleveringstidspunkt.');
  if (isNaN(endKm) || endKm < 0) return showError('dlm-error', 'Indtast en gyldig km-stand.');
  if (endKm < startKm) return showError('dlm-error', `Aflæst km (${endKm}) er lavere end bilens aktuelle km (${startKm}).`);
  const startTime = new Date(b.start_time);
  if (!state.adminUnlocked && endTime <= startTime)
    return showError('dlm-error', 'Afleveringstidspunktet skal være efter starttidspunktet.');

  // DB constraint kræver end_time > start_time — brug mindst start + 1 min
  const safeEndTime      = endTime > startTime ? endTime : new Date(startTime.getTime() + 60000);
  const durationQuarters = Math.max(1, Math.round((safeEndTime - startTime) / (15 * 60 * 1000)));
  const durTxt = fmtDur(durationQuarters * 15);

  const btn = document.getElementById('dlm-submit');
  btn.disabled = true; btn.textContent = 'Registrerer…';

  try {
    const { error: delErr } = await db.from('deliveries').insert({
      booking_id: b.id, car_id: b.car_id,
      start_km: startKm, end_km: endKm,
      duration_quarters: durationQuarters, comments,
    });
    if (delErr) throw delErr;

    await db.from('cars').update({ current_km: endKm }).eq('id', b.car_id);
    await db.from('bookings').update({ status: 'completed', end_time: safeEndTime.toISOString() }).eq('id', b.id);

    await logActivity('aflevering', b.car_id, b.id, b.user_name, {
      end_km: endKm, start_km: startKm, km_driven: endKm - startKm,
      duration_quarters: durationQuarters, duration_text: durTxt, comments,
    });

    toast(`${car?.name} afleveret — ${endKm - startKm} km kørt.`, 'success');
    closeDeliveryModal();
    await loadCars();
    await loadBookingsForCurrentView();
    renderCalendarGrid();
    renderCarToggles();
  } catch (err) {
    showError('dlm-error', err.message || 'Fejl ved registrering.');
  } finally {
    btn.disabled = false; btn.textContent = '✓ Registrer aflevering';
  }
});

// =============================================
// ADMIN ALL-BOOKINGS + ALL-DELIVERIES
// =============================================
async function loadAllBookingsAdmin() {
  const carFilter    = document.getElementById('ab-filter-car').value;
  const statusFilter = document.getElementById('ab-filter-status').value;
  let query = db.from('bookings').select('*, cars(name, color)')
    .order('start_time', { ascending: false }).limit(200);
  if (carFilter)    query = query.eq('car_id', carFilter);
  if (statusFilter) query = query.eq('status', statusFilter);
  const { data, error } = await query;
  if (error) { toast('Fejl ved indlæsning', 'error'); return; }
  adminData.bookings = data || [];
  const st = editState.bookings;
  const tbody = document.getElementById('ab-body');
  const theadRow = document.getElementById('ab-thead-row');
  if (st.active) {
    theadRow.innerHTML = `<th class="check-col"></th><th>Bil</th><th>Bruger</th><th>Telefon</th><th>Start</th><th>Slut</th><th>Forv. km</th><th>Status</th><th class="act-col"></th>`;
  } else {
    theadRow.innerHTML = `<th>Bil</th><th>Bruger</th><th>Telefon</th><th>Start</th><th>Slut</th><th>Forv. km</th><th>Status</th>`;
  }
  if (!adminData.bookings.length) {
    tbody.innerHTML = `<tr><td colspan="${st.active?9:7}" style="text-align:center;padding:24px;color:var(--muted)">Ingen bookinger.</td></tr>`;
    return;
  }
  const carDot = car => car ? `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${car.color};display:inline-block"></span>${car.name}</span>` : '–';
  tbody.innerHTML = adminData.bookings.map(b => {
    const statusLabel = { active:'Aktiv', completed:'Afsluttet', cancelled:'Annulleret' }[b.status] || b.status;
    const statusCls   = { active:'badge-blue', completed:'badge-green', cancelled:'badge-red' }[b.status] || 'badge-gray';
    const checked     = st.selected.has(b.id);
    return `<tr data-id="${b.id}" class="${checked ? 'row-selected' : ''}">
      ${st.active ? `<td class="check-col"><input type="checkbox" class="row-check" data-id="${b.id}" ${checked?'checked':''}></td>` : ''}
      <td>${carDot(b.cars)}</td>
      <td>${b.user_name}</td><td>${b.phone}</td>
      <td style="white-space:nowrap">${fmtDateTime(b.start_time)}</td>
      <td style="white-space:nowrap">${fmtDateTime(b.end_time)}</td>
      <td>${b.expected_km}</td>
      <td><span class="badge ${statusCls}">${statusLabel}</span></td>
      ${st.active ? `<td class="act-col"><button class="btn-icon" onclick="adminEditBooking('${b.id}')">&#9998;</button></td>` : ''}
    </tr>`;
  }).join('');
  if (st.active) {
    tbody.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) st.selected.add(cb.dataset.id);
        else st.selected.delete(cb.dataset.id);
        cb.closest('tr').classList.toggle('row-selected', cb.checked);
        updateSelCount('bookings');
      });
    });
  }
  updateSelCount('bookings');
}

async function loadAllDeliveriesAdmin() {
  const carFilter = document.getElementById('ad-filter-car').value;
  let query = db.from('deliveries').select('*, cars(name, color), bookings(user_name)')
    .order('created_at', { ascending: false }).limit(200);
  if (carFilter) query = query.eq('car_id', carFilter);
  const { data, error } = await query;
  if (error) { toast('Fejl ved indlæsning', 'error'); return; }
  adminData.deliveries = data || [];
  const st = editState.deliveries;
  const tbody = document.getElementById('ad-body');
  const theadRow = document.getElementById('ad-thead-row');
  if (st.active) {
    theadRow.innerHTML = `<th class="check-col"></th><th>Bil</th><th>Bruger</th><th>Tidspunkt</th><th>Start km</th><th>Slut km</th><th>Km kørt</th><th>Varighed</th><th>Kommentarer</th>`;
  } else {
    theadRow.innerHTML = `<th>Bil</th><th>Bruger</th><th>Tidspunkt</th><th>Start km</th><th>Slut km</th><th>Km kørt</th><th>Varighed</th><th>Kommentarer</th>`;
  }
  if (!adminData.deliveries.length) {
    tbody.innerHTML = `<tr><td colspan="${st.active?9:8}" style="text-align:center;padding:24px;color:var(--muted)">Ingen afleveringer.</td></tr>`;
    return;
  }
  const carDot = car => car ? `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${car.color};display:inline-block"></span>${car.name}</span>` : '–';
  tbody.innerHTML = adminData.deliveries.map(d => {
    const checked = st.selected.has(d.id);
    return `<tr data-id="${d.id}" class="${checked ? 'row-selected' : ''}">
      ${st.active ? `<td class="check-col"><input type="checkbox" class="row-check" data-id="${d.id}" ${checked?'checked':''}></td>` : ''}
      <td>${carDot(d.cars)}</td>
      <td>${d.bookings?.user_name || '–'}</td>
      <td style="white-space:nowrap">${fmtDateTime(d.created_at)}</td>
      <td>${d.start_km?.toLocaleString('da-DK')}</td>
      <td>${d.end_km?.toLocaleString('da-DK')}</td>
      <td>${d.km_driven?.toLocaleString('da-DK')}</td>
      <td>${fmtDur(d.duration_quarters * 15)}</td>
      <td>${d.comments || '–'}</td>
    </tr>`;
  }).join('');
  if (st.active) {
    tbody.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) st.selected.add(cb.dataset.id);
        else st.selected.delete(cb.dataset.id);
        cb.closest('tr').classList.toggle('row-selected', cb.checked);
        updateSelCount('deliveries');
      });
    });
  }
  updateSelCount('deliveries');
}

// =============================================
// ADMIN DATA CACHE + EDIT STATE
// =============================================
const adminData = { bookings: [], deliveries: [], log: [] };

const editState = {
  bookings:   { active: false, selected: new Set() },
  deliveries: { active: false, selected: new Set() },
  log:        { active: false, selected: new Set() },
};

function tabPrefix(tab) {
  return { bookings: 'ab', deliveries: 'ad', log: 'log' }[tab] || tab;
}

function updateSelCount(tab) {
  const st  = editState[tab];
  const pfx = tabPrefix(tab);
  const countEl = document.getElementById(`${pfx}-sel-count`);
  if (countEl) countEl.textContent = `${st.selected.size} valgte`;
  const editBtn = document.getElementById(`${pfx}-edit-selected`);
  if (editBtn) editBtn.disabled = st.selected.size !== 1;
  const delBtn = document.getElementById(`${pfx}-delete-selected`);
  if (delBtn) delBtn.disabled = st.selected.size === 0;
}

function toggleEditMode(tab) {
  const st  = editState[tab];
  const pfx = tabPrefix(tab);
  st.active = !st.active;
  st.selected.clear();
  const bar = document.getElementById(`${pfx}-edit-bar`);
  const btn = document.getElementById(`${pfx}-edit-toggle`);
  if (bar) bar.classList.toggle('hidden', !st.active);
  if (btn) {
    btn.style.background = st.active ? 'var(--primary)' : '';
    btn.style.color       = st.active ? '#fff' : '';
  }
  if (tab === 'bookings')   loadAllBookingsAdmin();
  if (tab === 'deliveries') loadAllDeliveriesAdmin();
  if (tab === 'log')        loadLog();
}

function adminEditBooking(bookingId) {
  const b = adminData.bookings.find(x => x.id === bookingId);
  if (!b) return;
  openBookingModal(b.car_id, new Date(b.start_time), b);
}

// =============================================
// DELETE WITH TRASH
// =============================================
async function deleteRowsWithTrash(tab, ids) {
  if (!ids.length) return;
  const noun = tab === 'bookings' ? 'booking' : tab === 'deliveries' ? 'aflevering' : 'log-post';
  if (!confirm(`Flytte ${ids.length} ${noun}${ids.length > 1 ? 'er' : ''} til skraldespanden?`)) return;
  try {
    if (tab === 'bookings') {
      for (const b of adminData.bookings.filter(b => ids.includes(b.id))) {
        addToTrash('booking', b, `${b.user_name} — ${b.cars?.name || ''} ${fmtDateTime(b.start_time)}`);
      }
      await db.from('bookings').delete().in('id', ids);
      await loadBookingsForCurrentView(); renderCalendarGrid();
      await loadAllBookingsAdmin();
    } else if (tab === 'deliveries') {
      for (const d of adminData.deliveries.filter(d => ids.includes(d.id))) {
        addToTrash('delivery', d, `${d.bookings?.user_name || '–'} — ${d.cars?.name || ''} ${fmtDateTime(d.created_at)}`);
      }
      await db.from('deliveries').delete().in('id', ids);
      await loadAllDeliveriesAdmin();
    } else {
      for (const l of adminData.log.filter(l => ids.includes(l.id))) {
        addToTrash('log', l, `${actionBadge(l.action_type).label} — ${fmtDateTime(l.created_at)}`);
      }
      await db.from('activity_log').delete().in('id', ids);
      await loadLog();
    }
    editState[tab].selected.clear();
    updateSelCount(tab);
    toast(`${ids.length} post${ids.length > 1 ? 'er' : ''} flyttet til skraldespanden`, 'info');
  } catch (err) {
    toast('Fejl: ' + (err.message || 'Ukendt'), 'error');
  }
}

// Edit-bar button wiring (runs after DOM ready, called from initAdminFilters)
function initEditBars() {
  // Bookings
  document.getElementById('ab-edit-toggle').addEventListener('click', () => toggleEditMode('bookings'));
  document.getElementById('ab-select-all').addEventListener('click', () => {
    adminData.bookings.forEach(b => editState.bookings.selected.add(b.id));
    loadAllBookingsAdmin();
  });
  document.getElementById('ab-edit-selected').addEventListener('click', () => {
    const ids = [...editState.bookings.selected];
    if (ids.length !== 1) return;
    adminEditBooking(ids[0]);
  });
  document.getElementById('ab-delete-selected').addEventListener('click', () =>
    deleteRowsWithTrash('bookings', [...editState.bookings.selected]));
  document.getElementById('ab-delete-all').addEventListener('click', () => {
    if (!confirm(`Flytte ALLE ${adminData.bookings.length} synlige bookinger til skraldespanden?`)) return;
    deleteRowsWithTrash('bookings', adminData.bookings.map(b => b.id));
  });

  // Deliveries
  document.getElementById('ad-edit-toggle').addEventListener('click', () => toggleEditMode('deliveries'));
  document.getElementById('ad-select-all').addEventListener('click', () => {
    adminData.deliveries.forEach(d => editState.deliveries.selected.add(d.id));
    loadAllDeliveriesAdmin();
  });
  document.getElementById('ad-delete-selected').addEventListener('click', () =>
    deleteRowsWithTrash('deliveries', [...editState.deliveries.selected]));
  document.getElementById('ad-delete-all').addEventListener('click', () => {
    if (!confirm(`Flytte ALLE ${adminData.deliveries.length} afleveringer til skraldespanden?`)) return;
    deleteRowsWithTrash('deliveries', adminData.deliveries.map(d => d.id));
  });

  // Log
  document.getElementById('log-edit-toggle').addEventListener('click', () => toggleEditMode('log'));
  document.getElementById('log-select-all').addEventListener('click', () => {
    adminData.log.forEach(l => editState.log.selected.add(l.id));
    loadLog();
  });
  document.getElementById('log-delete-selected').addEventListener('click', () =>
    deleteRowsWithTrash('log', [...editState.log.selected]));
  document.getElementById('log-delete-all').addEventListener('click', () => {
    if (!confirm(`Flytte ALLE ${adminData.log.length} log-poster til skraldespanden?`)) return;
    deleteRowsWithTrash('log', adminData.log.map(l => l.id));
  });
}

// =============================================
// EXPORT
// =============================================
function downloadCSV(headers, rows, filename) {
  const BOM = '﻿';
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = BOM + [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: filename,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function downloadJSON(data, filename) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })),
    download: filename,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function exportAdminData(tab, fmt) {
  document.querySelectorAll('.export-menu').forEach(m => m.classList.add('hidden'));
  if (tab === 'bookings') {
    const rows = adminData.bookings.map(b => [
      b.cars?.name || '', b.user_name, b.phone,
      fmtDateTime(b.start_time), fmtDateTime(b.end_time), b.expected_km,
      { active: 'Aktiv', completed: 'Afsluttet', cancelled: 'Annulleret' }[b.status] || b.status,
      b.notes || '',
    ]);
    if (fmt === 'csv') downloadCSV(['Bil','Bruger','Telefon','Start','Slut','Forv. km','Status','Bemærkninger'], rows, `bookinger-${todayStr()}.csv`);
    else downloadJSON(adminData.bookings, `bookinger-${todayStr()}.json`);
  } else if (tab === 'deliveries') {
    const rows = adminData.deliveries.map(d => [
      d.cars?.name || '', d.bookings?.user_name || '', fmtDateTime(d.created_at),
      d.start_km, d.end_km, d.km_driven, fmtDur(d.duration_quarters * 15), d.comments || '',
    ]);
    if (fmt === 'csv') downloadCSV(['Bil','Bruger','Tidspunkt','Start km','Slut km','Km kørt','Varighed','Kommentarer'], rows, `afleveringer-${todayStr()}.csv`);
    else downloadJSON(adminData.deliveries, `afleveringer-${todayStr()}.json`);
  } else {
    const rows = adminData.log.map(l => [
      fmtDateTime(l.created_at), actionBadge(l.action_type).label,
      l.cars?.name || '', l.user_name || '', formatLogDetails(l.action_type, l.details),
    ]);
    if (fmt === 'csv') downloadCSV(['Tidspunkt','Handling','Bil','Bruger','Detaljer'], rows, `log-${todayStr()}.csv`);
    else downloadJSON(adminData.log, `log-${todayStr()}.json`);
  }
}

function exportTrashData(fmt) {
  document.querySelectorAll('.export-menu').forEach(m => m.classList.add('hidden'));
  const items = getTrash();
  if (!items.length) return toast('Skraldespanden er tom', 'info');
  if (fmt === 'csv') {
    const rows = items.map(t => [t.type, t.label, fmtDateTime(t.deletedAt), JSON.stringify(t.data)]);
    downloadCSV(['Type','Beskrivelse','Slettet','Data (JSON)'], rows, `skraldespand-${todayStr()}.csv`);
  } else {
    downloadJSON(items, `skraldespand-${todayStr()}.json`);
  }
}

// Export dropdown toggle (close-on-outside-click)
function initExportDropdowns() {
  ['ab','ad','log','trash'].forEach(pfx => {
    const btn  = document.getElementById(`${pfx}-export-btn`);
    const menu = document.getElementById(`${pfx}-export-menu`);
    if (!btn || !menu) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wasHidden = menu.classList.contains('hidden');
      document.querySelectorAll('.export-menu').forEach(m => m.classList.add('hidden'));
      if (wasHidden) menu.classList.remove('hidden');
    });
  });
  document.addEventListener('click', () =>
    document.querySelectorAll('.export-menu').forEach(m => m.classList.add('hidden')));
}

// =============================================
// TRASH (localStorage)
// =============================================
const TRASH_KEY = 'bilbooking_trash';
function getTrash() { return JSON.parse(localStorage.getItem(TRASH_KEY) || '[]'); }
function saveTrash(t) { localStorage.setItem(TRASH_KEY, JSON.stringify(t)); }

function addToTrash(type, data, label) {
  const trash = getTrash();
  trash.unshift({ id: crypto.randomUUID(), type, data, label, deletedAt: new Date().toISOString() });
  saveTrash(trash);
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderTrash() {
  const items   = getTrash();
  const container = document.getElementById('trash-content');
  if (!items.length) {
    container.innerHTML = `<div class="trash-empty">&#128465; Skraldespanden er tom</div>`;
    return;
  }
  const groups  = { booking: [], delivery: [], log: [] };
  items.forEach(item => { (groups[item.type] = groups[item.type] || []).push(item); });
  const labels  = { booking: '&#128197; Bookinger', delivery: '&#9989; Afleveringer', log: '&#128221; Log-poster' };
  let html = '';
  for (const [type, group] of Object.entries(groups)) {
    if (!group?.length) continue;
    html += `<div class="trash-section">
      <div class="trash-section-header">${labels[type] || type} &mdash; ${group.length} post${group.length > 1 ? 'er' : ''}</div>
      ${group.map(item => `
        <div class="trash-item">
          <div class="trash-item-label">
            <div>${escHtml(item.label)}</div>
            <div class="trash-item-meta">Slettet ${fmtDateTime(item.deletedAt)}</div>
          </div>
          <div class="trash-item-actions">
            <button class="btn-sm" onclick="restoreFromTrash('${item.id}')">&#8629; Gendan</button>
            <button class="btn-sm btn-danger" onclick="permanentDeleteTrashItem('${item.id}')">&#10005; Slet</button>
          </div>
        </div>`).join('')}
    </div>`;
  }
  container.innerHTML = html;
}

function permanentDeleteTrashItem(trashId) {
  if (!confirm('Slette permanent? Dette kan IKKE fortrydes.')) return;
  saveTrash(getTrash().filter(t => t.id !== trashId));
  renderTrash();
  toast('Permanent slettet', 'info');
}

document.getElementById('trash-empty-all').addEventListener('click', () => {
  const items = getTrash();
  if (!items.length) return toast('Skraldespanden er allerede tom', 'info');
  if (!confirm(`Slette alle ${items.length} elementer PERMANENT? Dette kan ikke fortrydes.`)) return;
  saveTrash([]);
  renderTrash();
  toast('Skraldespand tømt', 'info');
});

async function restoreFromTrash(trashId) {
  const trash = getTrash();
  const item  = trash.find(t => t.id === trashId);
  if (!item) return;
  if (!confirm(`Gendanne "${escHtml(item.label)}"?`)) return;

  try {
    if (item.type === 'booking') {
      const b = item.data;
      // Reload state.bookings for accurate conflict detection
      await loadBookingsForCurrentView();
      const conflict = findConflictInfo(b.car_id, b.start_time, b.end_time, null);
      if (conflict) {
        const { first, nextFree } = conflict;
        alert(`Kan ikke gendanne — konflikt med booking af ${first.user_name}\n(${fmtDateTime(first.start_time)} – ${fmtTime(first.end_time)})\n\nLedig fra: ${fmtDateTime(nextFree)}`);
        return;
      }
      const { error } = await db.from('bookings').insert({
        id: b.id, car_id: b.car_id, user_name: b.user_name, phone: b.phone,
        start_time: b.start_time, end_time: b.end_time,
        expected_km: b.expected_km, start_km: b.start_km || 0,
        notes: b.notes || null, status: b.status || 'active',
      });
      if (error) throw error;
      await loadBookingsForCurrentView(); renderCalendarGrid();
    } else if (item.type === 'delivery') {
      const d = item.data;
      const { error } = await db.from('deliveries').insert({
        id: d.id, booking_id: d.booking_id || null, car_id: d.car_id,
        start_km: d.start_km, end_km: d.end_km,
        duration_quarters: d.duration_quarters, comments: d.comments || null,
        created_at: d.created_at,
      });
      if (error) throw error;
    } else if (item.type === 'log') {
      const l = item.data;
      const { error } = await db.from('activity_log').insert({
        id: l.id, car_id: l.car_id || null, action_type: l.action_type,
        user_name: l.user_name || null, details: l.details || null,
        created_at: l.created_at,
      });
      if (error) throw error;
    }

    saveTrash(trash.filter(t => t.id !== trashId));
    renderTrash();
    toast('Gendannet', 'success');

    // Reload relevant tab if active
    const activeTab = document.querySelector('.admin-tab.active')?.dataset.tab;
    if (activeTab === 'bookings')   loadAllBookingsAdmin();
    if (activeTab === 'deliveries') loadAllDeliveriesAdmin();
    if (activeTab === 'log')        loadLog();
  } catch (err) {
    toast('Fejl ved gendannelse: ' + (err.message || 'Ukendt'), 'error');
  }
}

function initAdminFilters() {
  const carOptions = `<option value="">Alle biler</option>` +
    state.cars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('ab-filter-car').innerHTML = carOptions;
  document.getElementById('ad-filter-car').innerHTML = carOptions;
  document.getElementById('ab-refresh').addEventListener('click', loadAllBookingsAdmin);
  document.getElementById('ab-filter-car').addEventListener('change', loadAllBookingsAdmin);
  document.getElementById('ab-filter-status').addEventListener('change', loadAllBookingsAdmin);
  document.getElementById('ad-refresh').addEventListener('click', loadAllDeliveriesAdmin);
  document.getElementById('ad-filter-car').addEventListener('change', loadAllDeliveriesAdmin);
}

// Admin tab switching
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`admin-tab-${tab.dataset.tab}`)?.classList.remove('hidden');
    if (tab.dataset.tab === 'log')         loadLog();
    if (tab.dataset.tab === 'bookings')    loadAllBookingsAdmin();
    if (tab.dataset.tab === 'deliveries')  loadAllDeliveriesAdmin();
    if (tab.dataset.tab === 'trash')       renderTrash();
  });
});

// =============================================
// LOG VIEW
// =============================================
async function loadLog() {
  const carFilter    = document.getElementById('log-filter-car').value;
  const actionFilter = document.getElementById('log-filter-action').value;
  let query = db.from('activity_log').select('*, cars(name, color)')
    .order('created_at', { ascending: false }).limit(200);
  if (carFilter)    query = query.eq('car_id', carFilter);
  if (actionFilter) query = query.eq('action_type', actionFilter);
  const { data, error } = await query;
  if (error) { toast('Fejl ved indlæsning af log', 'error'); return; }
  adminData.log = data || [];
  const st = editState.log;
  const tbody = document.getElementById('log-body');
  const theadRow = document.getElementById('log-thead-row');
  if (st.active) {
    theadRow.innerHTML = `<th class="check-col"></th><th>Tidspunkt</th><th>Handling</th><th>Bil</th><th>Bruger</th><th>Detaljer</th>`;
  } else {
    theadRow.innerHTML = `<th>Tidspunkt</th><th>Handling</th><th>Bil</th><th>Bruger</th><th>Detaljer</th>`;
  }
  if (!adminData.log.length) {
    tbody.innerHTML = `<tr><td colspan="${st.active?6:5}" style="text-align:center;padding:24px;color:var(--muted)">Ingen log-poster endnu.</td></tr>`;
    return;
  }
  const carDot = car => car ? `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${car.color};display:inline-block"></span>${car.name}</span>` : '–';
  tbody.innerHTML = adminData.log.map(row => {
    const badge = actionBadge(row.action_type);
    const checked = st.selected.has(row.id);
    return `<tr data-id="${row.id}" class="${checked ? 'row-selected' : ''}">
      ${st.active ? `<td class="check-col"><input type="checkbox" class="row-check" data-id="${row.id}" ${checked?'checked':''}></td>` : ''}
      <td style="white-space:nowrap;color:var(--muted)">${fmtDateTime(row.created_at)}</td>
      <td><span class="badge ${badge.cls}">${badge.label}</span></td>
      <td>${carDot(row.cars)}</td>
      <td>${row.user_name || '–'}</td>
      <td class="log-details">${formatLogDetails(row.action_type, row.details)}</td>
    </tr>`;
  }).join('');
  if (st.active) {
    tbody.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) st.selected.add(cb.dataset.id);
        else st.selected.delete(cb.dataset.id);
        cb.closest('tr').classList.toggle('row-selected', cb.checked);
        updateSelCount('log');
      });
    });
  }
  updateSelCount('log');
}

function actionBadge(type) {
  return ({
    booking_oprettet:   { label:'Booking oprettet',  cls:'badge-blue'   },
    booking_annulleret: { label:'Booking annulleret', cls:'badge-red'    },
    booking_aendret:    { label:'Booking ændret',     cls:'badge-yellow' },
    aflevering:         { label:'Aflevering',         cls:'badge-green'  },
    km_override:        { label:'KM ændret',          cls:'badge-yellow' },
    bil_oprettet:       { label:'Bil oprettet',       cls:'badge-purple' },
    bil_slettet:        { label:'Bil slettet',        cls:'badge-red'    },
    bil_aendret:        { label:'Bil ændret',         cls:'badge-gray'   },
  })[type] || { label: type, cls: 'badge-gray' };
}

function formatLogDetails(type, d) {
  if (!d) return '';
  try {
    if (type === 'booking_oprettet' || type === 'booking_aendret')
      return `${fmtDateTime(d.start_time)} → ${fmtDateTime(d.end_time)}, start km: ${d.start_km?.toLocaleString('da-DK')}`;
    if (type === 'booking_annulleret')
      return `${fmtDateTime(d.start_time)} → ${fmtDateTime(d.end_time)}`;
    if (type === 'aflevering')
      return `${d.km_driven} km kørt, ${d.duration_text}, slut km: ${d.end_km?.toLocaleString('da-DK')}${d.comments ? ` — ${d.comments}` : ''}`;
    if (type === 'km_override')
      return `Foreslået: ${d.suggested_km?.toLocaleString('da-DK')} → Indtastet: ${d.entered_km?.toLocaleString('da-DK')} km`;
    if (type === 'bil_aendret')
      return Object.entries(d).map(([k,v]) => `${k}: ${v}`).join(', ');
    return JSON.stringify(d);
  } catch { return ''; }
}

function initLogFilters() {
  const sel = document.getElementById('log-filter-car');
  sel.innerHTML = `<option value="">Alle biler</option>` +
    state.cars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('log-refresh').addEventListener('click', loadLog);
  document.getElementById('log-filter-car').addEventListener('change', loadLog);
  document.getElementById('log-filter-action').addEventListener('change', loadLog);
}

// =============================================
// ADMIN VIEW
// =============================================
document.getElementById('admin-pw-btn').addEventListener('click', () => {
  if (document.getElementById('admin-pw').value === ADMIN_PASSWORD) {
    document.getElementById('admin-gate').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    state.adminUnlocked = true;
    renderAdminCars(); loadAdminBookings(); initAdminFilters(); initLogFilters();
    initEditBars(); initExportDropdowns();
  } else {
    document.getElementById('admin-pw-error').classList.remove('hidden');
  }
});
document.getElementById('admin-pw').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('admin-pw-btn').click();
});

function renderAdminCars() {
  const list = document.getElementById('admin-car-list');
  list.innerHTML = state.cars.map(car => `
    <div class="car-admin-row">
      <div class="car-info">
        <span class="car-dot" style="background:${car.color}"></span>
        <div><strong>${car.name}</strong><small style="display:block">${car.current_km.toLocaleString('da-DK')} km</small></div>
      </div>
      <div class="car-actions">
        <button class="btn-icon" data-action="edit" data-car-id="${car.id}">✏ Rediger</button>
        <button class="btn-icon danger" data-action="delete" data-car-id="${car.id}">🗑 Slet</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-action="edit"]').forEach(b => b.addEventListener('click', () => openEditCarModal(b.dataset.carId)));
  list.querySelectorAll('[data-action="delete"]').forEach(b => b.addEventListener('click', () => deleteCarPrompt(b.dataset.carId)));
}

async function loadAdminBookings() {
  const { data } = await db.from('bookings').select('*, cars(name, color)')
    .eq('status', 'active').gte('end_time', new Date().toISOString())
    .order('start_time').limit(20);
  const c = document.getElementById('admin-bookings');
  if (!data?.length) { c.innerHTML = '<p style="color:var(--muted)">Ingen kommende bookinger.</p>'; return; }
  c.innerHTML = data.map(b => `
    <div class="booking-admin-row">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span style="width:8px;height:8px;border-radius:50%;background:${b.cars?.color};display:inline-block"></span>
        <strong>${b.cars?.name}</strong><span style="color:var(--muted)">— ${b.user_name}</span>
      </div>
      <div style="color:var(--muted)">${fmtDateTime(b.start_time)} → ${fmtDateTime(b.end_time)}</div>
    </div>`).join('');
}

document.getElementById('new-car-btn').addEventListener('click', async () => {
  const name  = document.getElementById('new-car-name').value.trim();
  const color = document.getElementById('new-car-color').value;
  const km    = parseInt(document.getElementById('new-car-km').value, 10) || 0;
  if (!name) return showError('new-car-error', 'Indtast et navn.');
  try {
    const { data, error } = await db.from('cars').insert({ name, color, current_km: km }).select().single();
    if (error) throw error;
    await logActivity('bil_oprettet', data.id, null, null, { name, color, km });
    toast(`${name} tilføjet`, 'success');
    document.getElementById('new-car-name').value = '';
    document.getElementById('new-car-km').value = '0';
    showError('new-car-error', '');
    await loadCars(); renderAdminCars(); renderCarToggles(); renderCalendarGrid();
  } catch (err) { showError('new-car-error', err.message); }
});

function openEditCarModal(carId) {
  const car = state.cars.find(c => c.id === carId);
  if (!car) return;
  document.getElementById('ecm-car-id').value = carId;
  document.getElementById('ecm-name').value   = car.name;
  document.getElementById('ecm-color').value  = car.color;
  document.getElementById('ecm-km').value     = car.current_km;
  showError('ecm-error', '');
  document.getElementById('edit-car-modal').classList.remove('hidden');
}

document.getElementById('ecm-close').addEventListener('click',  () => document.getElementById('edit-car-modal').classList.add('hidden'));
document.getElementById('ecm-cancel').addEventListener('click', () => document.getElementById('edit-car-modal').classList.add('hidden'));

document.getElementById('ecm-save').addEventListener('click', async () => {
  const carId = document.getElementById('ecm-car-id').value;
  const name  = document.getElementById('ecm-name').value.trim();
  const color = document.getElementById('ecm-color').value;
  const km    = parseInt(document.getElementById('ecm-km').value, 10) || 0;
  if (!name) return showError('ecm-error', 'Navn må ikke være tomt.');
  const car = state.cars.find(c => c.id === carId);
  const changes = {};
  if (car.name !== name) changes.name = `${car.name} → ${name}`;
  if (car.color !== color) changes.color = `${car.color} → ${color}`;
  if (car.current_km !== km) changes.current_km = `${car.current_km} → ${km}`;
  try {
    const { error } = await db.from('cars').update({ name, color, current_km: km }).eq('id', carId);
    if (error) throw error;
    if (Object.keys(changes).length) await logActivity('bil_aendret', carId, null, null, changes);
    document.getElementById('edit-car-modal').classList.add('hidden');
    toast(`${name} opdateret`, 'success');
    await loadCars(); renderAdminCars(); renderCarToggles(); renderCalendarGrid();
  } catch (err) { showError('ecm-error', err.message); }
});

async function deleteCarPrompt(carId) {
  const car = state.cars.find(c => c.id === carId);
  if (!confirm(`Vil du slette "${car?.name}"?\n\nAlle bookinger for denne bil slettes også.`)) return;
  try {
    await db.from('cars').update({ active: false }).eq('id', carId);
    await logActivity('bil_slettet', carId, null, null, { name: car?.name });
    toast(`${car?.name} slettet`, 'info');
    state.enabledCars.delete(carId);
    await loadCars(); renderAdminCars(); renderCarToggles(); renderCalendarGrid();
  } catch (err) { toast('Fejl: ' + err.message, 'error'); }
}

// =============================================
// HELPERS
// =============================================
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = msg;
  el.classList.toggle('hidden', !msg);
}

// =============================================
// NAVIGATION
// =============================================
function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${view}`)?.classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-view="${view}"]`)?.classList.add('active');
  if (view === 'admin' && state.adminUnlocked) { renderAdminCars(); loadAdminBookings(); }

  // Knappen skifter label afhængigt af om hjælpevisningen er aktiv
  const helpBtn = document.querySelector('.nav-btn[data-view="help"]');
  if (helpBtn) helpBtn.textContent = (view === 'help') ? 'Kalender' : 'Vejledning';
}
document.querySelectorAll('.nav-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    // Help-knappen fungerer som toggle: åbner vejledning eller vender tilbage til kalender
    if (btn.dataset.view === 'help' && state.currentView === 'help') {
      setView('calendar');
    } else {
      setView(btn.dataset.view);
    }
  }));

// Logo: enkelt klik → kalender; 5 hurtige klik → admin
(function () {
  let clicks = 0, timer;
  document.getElementById('logo-btn').addEventListener('click', () => {
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (clicks === 1) setView('calendar');
      clicks = 0;
    }, 400);
    if (clicks >= 5) { clearTimeout(timer); clicks = 0; setView('admin'); }
  });
})();

document.getElementById('prev-week').addEventListener('click', async () => {
  if (state.viewMode === 'day')   state.selectedDay   = addDays(state.selectedDay, -1);
  else if (state.viewMode==='week') state.weekStart   = addDays(state.weekStart, -7);
  else state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth()-1, 1);
  await loadBookingsForCurrentView();
  renderNavLabel(); renderCalendarGrid();
});

document.getElementById('next-week').addEventListener('click', async () => {
  if (state.viewMode === 'day')   state.selectedDay   = addDays(state.selectedDay, 1);
  else if (state.viewMode==='week') state.weekStart   = addDays(state.weekStart, 7);
  else state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth()+1, 1);
  await loadBookingsForCurrentView();
  renderNavLabel(); renderCalendarGrid();
});

document.getElementById('today-btn').addEventListener('click', async () => {
  const today = new Date(); today.setHours(0,0,0,0);
  state.selectedDay   = today;
  state.weekStart     = getMonday(today);
  state.currentMonth  = new Date(today.getFullYear(), today.getMonth(), 1);
  await loadBookingsForCurrentView();
  renderNavLabel(); renderCalendarGrid();
});

['booking-modal','detail-modal','delivery-modal','edit-car-modal'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
});

// =============================================
// INIT
// =============================================
async function init() {
  try {
    await loadCars();
    await loadBookingsForCurrentView();
    renderCalendar();
  } catch (err) {
    console.error('Init error:', err);
    toast('Kunne ikke forbinde til databasen.', 'error', 8000);
  }
}

document.addEventListener('DOMContentLoaded', init);
