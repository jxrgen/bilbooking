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

    const bStart  = new Date(b.start_time);
    const bEnd    = new Date(b.end_time);
    const clampS  = Math.max((bStart.getHours()*60 + bStart.getMinutes()) - DAY_START_H*60, 0);
    const clampE  = Math.min((bEnd.getHours()*60   + bEnd.getMinutes())   - DAY_START_H*60, DAY_MINUTES);
    const h       = Math.max(clampE - clampS, 18);

    const carIdx  = enabledCars.findIndex(c => c.id === b.car_id);
    const total   = enabledCars.length;
    const lPct    = (carIdx / total) * 100;
    const wPct    = 100 / total;

    const isCompleted = b.status === 'completed';
    return `
      <div class="booking-block${isCompleted ? ' completed' : ''}"
        style="top:${clampS}px;height:${h}px;left:calc(${lPct}% + 1px);width:calc(${wPct}% - 2px);${isCompleted ? '' : `background:${car.color};`}"
        data-booking-id="${b.id}">
        <span class="bb-name">${b.user_name}</span>
        ${h >= 32 ? `<span class="bb-time">${fmtTime(bStart)}–${fmtTime(bEnd)}</span>` : ''}
        ${h >= 48 ? `<span class="bb-car">${car.name}</span>` : ''}
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

  document.getElementById('bm-start').value   = toLocal(editingBooking ? new Date(editingBooking.start_time) : roundTo15(suggestedStart));
  document.getElementById('bm-end').value     = toLocal(editingBooking ? new Date(editingBooking.end_time)   : roundTo15(suggestedEnd));
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


function snapStartInput() {
  const raw = document.getElementById('bm-start').value;
  if (!raw) return;
  const snapped = roundTo15(new Date(raw));
  document.getElementById('bm-start').value = toLocal(snapped);
  const endInput = document.getElementById('bm-end');
  if (!endInput.value || new Date(endInput.value) <= snapped) {
    const newEnd = new Date(snapped);
    newEnd.setHours(newEnd.getHours() + 1);
    endInput.value = toLocal(newEnd);
  }
}
function snapEndInput() {
  const raw = document.getElementById('bm-end').value;
  if (raw) document.getElementById('bm-end').value = toLocal(roundTo15(new Date(raw)));
}
document.getElementById('bm-start').addEventListener('change', snapStartInput);
document.getElementById('bm-start').addEventListener('blur',   snapStartInput);
document.getElementById('bm-end').addEventListener('change',   snapEndInput);
document.getElementById('bm-end').addEventListener('blur',     snapEndInput);

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
  const startVal = document.getElementById('bm-start').value;
  const endVal   = document.getElementById('bm-end').value;
  const notes    = document.getElementById('bm-notes').value.trim();

  if (!name)   return showError('bm-error', 'Indtast dit navn.');
  if (!phone)  return showError('bm-error', 'Indtast dit telefonnummer.');
  if (!expKm || expKm < 0) return showError('bm-error', 'Forventet km skal være større end 0.');
  if (!startVal || !endVal) return showError('bm-error', 'Vælg start- og sluttidspunkt.');

  const startTime = roundTo15(new Date(startVal));
  const endTime   = roundTo15(new Date(endVal));

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
        <div class="dm-row"><label>Afleveret</label><span>${fmtDateTime(del.delivered_at)}</span></div>
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
  document.getElementById('dlm-end-time').value = toLocal(roundTo15(new Date()));
  document.getElementById('dlm-start-km').value = car?.current_km || 0;
  document.getElementById('dlm-end-km').value   = '';
  document.getElementById('dlm-km-driven').value = '';
  document.getElementById('dlm-comments').value  = '';
  showError('dlm-error', '');

  document.getElementById('detail-modal').classList.add('hidden');
  document.getElementById('delivery-modal').classList.remove('hidden');
  document.getElementById('dlm-end-km').focus();
}

function snapDeliveryTime() {
  const raw = document.getElementById('dlm-end-time').value;
  if (raw) document.getElementById('dlm-end-time').value = toLocal(roundTo15(new Date(raw)));
}
document.getElementById('dlm-end-time').addEventListener('change', snapDeliveryTime);
document.getElementById('dlm-end-time').addEventListener('blur',   snapDeliveryTime);

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
  const endTimeVal = document.getElementById('dlm-end-time').value;
  const comments   = document.getElementById('dlm-comments').value.trim();

  if (!endTimeVal)             return showError('dlm-error', 'Vælg afleveringstidspunkt.');
  if (isNaN(endKm) || endKm < 0) return showError('dlm-error', 'Indtast en gyldig km-stand.');
  if (endKm < startKm) return showError('dlm-error', `Aflæst km (${endKm}) er lavere end bilens aktuelle km (${startKm}).`);

  const endTime  = new Date(endTimeVal);
  const startTime = new Date(b.start_time);
  if (!state.adminUnlocked && endTime <= startTime)
    return showError('dlm-error', 'Afleveringstidspunktet skal være efter starttidspunktet.');

  // DB constraint kræver end_time > start_time — brug mindst start + 1 min
  const safeEndTime      = endTime > startTime ? endTime : new Date(startTime.getTime() + 60000);
  const durationQuarters = Math.max(1, Math.round((safeEndTime - startTime) / (15 * 60 * 1000)));
  const h      = Math.floor(durationQuarters / 4);
  const m      = (durationQuarters % 4) * 15;
  const durTxt = `${h}t${m ? ' ' + m + 'min' : ''}`;

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
  const tbody = document.getElementById('ab-body');
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">Ingen bookinger.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(b => {
    const car = b.cars;
    const statusLabel = { active:'Aktiv', completed:'Afsluttet', cancelled:'Annulleret' }[b.status] || b.status;
    const statusCls   = { active:'badge-blue', completed:'badge-green', cancelled:'badge-red' }[b.status] || 'badge-gray';
    return `
      <tr>
        <td>${car ? `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${car.color};display:inline-block"></span>${car.name}</span>` : '–'}</td>
        <td>${b.user_name}</td><td>${b.phone}</td>
        <td style="white-space:nowrap">${fmtDateTime(b.start_time)}</td>
        <td style="white-space:nowrap">${fmtDateTime(b.end_time)}</td>
        <td>${b.start_km?.toLocaleString('da-DK')}</td>
        <td>${b.expected_km}</td>
        <td><span class="badge ${statusCls}">${statusLabel}</span></td>
      </tr>`;
  }).join('');
}

async function loadAllDeliveriesAdmin() {
  const carFilter = document.getElementById('ad-filter-car').value;
  let query = db.from('deliveries').select('*, cars(name, color), bookings(user_name)')
    .order('created_at', { ascending: false }).limit(200);
  if (carFilter) query = query.eq('car_id', carFilter);
  const { data, error } = await query;
  if (error) { toast('Fejl ved indlæsning', 'error'); return; }
  const tbody = document.getElementById('ad-body');
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">Ingen afleveringer.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(d => {
    const car  = d.cars;
    const h    = Math.floor(d.duration_quarters / 4);
    const m    = (d.duration_quarters % 4) * 15;
    const durTxt = `${h}t${m ? ' '+m+'min' : ''}`;
    return `
      <tr>
        <td>${car ? `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${car.color};display:inline-block"></span>${car.name}</span>` : '–'}</td>
        <td>${d.bookings?.user_name || '–'}</td>
        <td style="white-space:nowrap">${fmtDateTime(d.created_at)}</td>
        <td>${d.start_km?.toLocaleString('da-DK')}</td>
        <td>${d.end_km?.toLocaleString('da-DK')}</td>
        <td>${d.km_driven?.toLocaleString('da-DK')}</td>
        <td>${durTxt}</td>
        <td>${d.comments || '–'}</td>
      </tr>`;
  }).join('');
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

  const tbody = document.getElementById('log-body');
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">Ingen log-poster endnu.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(row => {
    const car = row.cars;
    const badge = actionBadge(row.action_type);
    return `
      <tr>
        <td style="white-space:nowrap;color:var(--muted)">${fmtDateTime(row.created_at)}</td>
        <td><span class="badge ${badge.cls}">${badge.label}</span></td>
        <td>${car ? `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${car.color};display:inline-block"></span>${car.name}</span>` : '–'}</td>
        <td>${row.user_name || '–'}</td>
        <td class="log-details">${formatLogDetails(row.action_type, row.details)}</td>
      </tr>`;
  }).join('');
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
