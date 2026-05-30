// =============================================
// CONFIG
// =============================================
const SUPABASE_URL = 'https://fdwiooogkophykysbbrh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TEUUw-SUTC_XyQ3aNK1VKg_s9A8WAf4';
const ADMIN_PASSWORD = 'bilklub2024';
const DAY_START_H = 6;   // kalenderen starter kl. 06:00
const DAY_END_H   = 22;  // kalenderen slutter kl. 22:00

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// =============================================
// STATE
// =============================================
const state = {
  cars: [],
  bookings: [],          // bookinger for synlig uge + nabouge (for overlap-check)
  enabledCars: new Set(),
  weekStart: getMonday(new Date()),
  currentView: 'calendar',
  adminUnlocked: false,
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

function fmtDate(date) {
  return new Date(date).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDayNum(date) {
  return new Date(date).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
}

function fmtWeekday(date) {
  return new Date(date).toLocaleDateString('da-DK', { weekday: 'long' });
}

function fmtTime(date) {
  return new Date(date).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(date) {
  return new Date(date).toLocaleDateString('da-DK', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function toLocal(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function roundToQuarter(date) {
  const d = new Date(date);
  d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

function isSameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function cap(str, n) {
  return str.charAt(0).toUpperCase() + str.slice(1, n);
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

async function loadBookings() {
  // Load bookings for week + 1 day buffer each side for overlap detection
  const from = addDays(state.weekStart, -1);
  const to   = addDays(state.weekStart, 8);

  const { data, error } = await db
    .from('bookings')
    .select('*, cars(name, color)')
    .gte('end_time', from.toISOString())
    .lte('start_time', to.toISOString())
    .eq('status', 'active')
    .order('start_time');

  if (error) throw error;
  state.bookings = data;
}

async function loadAllBookingsForCar(carId) {
  const { data, error } = await db
    .from('bookings')
    .select('*')
    .eq('car_id', carId)
    .eq('status', 'active')
    .gte('end_time', new Date().toISOString())
    .order('start_time');
  if (error) throw error;
  return data;
}

async function logActivity(actionType, carId, bookingId, userName, details) {
  const { error } = await db.from('activity_log').insert({
    action_type: actionType,
    car_id: carId || null,
    booking_id: bookingId || null,
    user_name: userName || null,
    details: details || {},
  });
  if (error) console.error('Log error:', error);
}

function bookingsOverlap(existingBookings, carId, startTime, endTime, excludeId = null) {
  const s = new Date(startTime);
  const e = new Date(endTime);
  return existingBookings.some(b => {
    if (b.car_id !== carId) return false;
    if (excludeId && b.id === excludeId) return false;
    if (b.status !== 'active') return false;
    const bs = new Date(b.start_time);
    const be = new Date(b.end_time);
    return s < be && e > bs;
  });
}

async function createBooking(data) {
  // Double-check overlap against DB (state might be stale)
  const { data: existing } = await db
    .from('bookings')
    .select('id')
    .eq('car_id', data.car_id)
    .eq('status', 'active')
    .lt('start_time', data.end_time)
    .gt('end_time', data.start_time);

  if (existing && existing.length > 0) {
    throw new Error('Bilen er allerede booket i dette tidsrum — dobbelttjekket mod databasen.');
  }

  const { data: created, error } = await db.from('bookings').insert(data).select().single();
  if (error) throw error;

  await logActivity('booking_oprettet', data.car_id, created.id, data.user_name, {
    start_time: data.start_time,
    end_time: data.end_time,
    expected_km: data.expected_km,
    start_km: data.start_km,
  });

  return created;
}

async function cancelBooking(bookingId) {
  const booking = state.bookings.find(b => b.id === bookingId)
    || (await db.from('bookings').select('*').eq('id', bookingId).single()).data;

  const { error } = await db
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId);
  if (error) throw error;

  await logActivity('booking_annulleret', booking.car_id, bookingId, booking.user_name, {
    start_time: booking.start_time,
    end_time: booking.end_time,
  });
}

// =============================================
// CALENDAR RENDERING
// =============================================
const DAY_MINUTES = (DAY_END_H - DAY_START_H) * 60;

function pct(minutes) {
  return ((minutes - DAY_START_H * 60) / DAY_MINUTES) * 100;
}

function renderCarToggles() {
  const container = document.getElementById('car-toggles');
  container.innerHTML = state.cars.map(car => `
    <button class="toggle-btn ${state.enabledCars.has(car.id) ? 'on' : 'off'}"
      data-car-id="${car.id}"
      style="border-color: ${car.color}; color: ${car.color};">
      <span class="dot" style="background: ${car.color};"></span>
      ${car.name}
    </button>
  `).join('');

  container.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.carId;
      if (state.enabledCars.has(id)) {
        state.enabledCars.delete(id);
        btn.classList.replace('on', 'off');
      } else {
        state.enabledCars.add(id);
        btn.classList.replace('off', 'on');
      }
      renderCalendarGrid();
    });
  });
}

function renderWeekLabel() {
  const end = addDays(state.weekStart, 6);
  document.getElementById('week-label').textContent =
    `${fmtDayNum(state.weekStart)} – ${fmtDayNum(end)} ${state.weekStart.getFullYear()}`;
}

function renderCalendar() {
  renderCarToggles();
  renderWeekLabel();
  renderCalendarGrid();
}

function renderCalendarGrid() {
  const grid = document.getElementById('calendar-grid');
  const enabledCars = state.cars.filter(c => state.enabledCars.has(c.id));
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const numCols = 1 + days.length; // label col + 7 day cols
  grid.style.gridTemplateColumns = `120px repeat(7, 1fr)`;

  let html = '';

  // === HEADER ROW ===
  html += `<div class="cal-time-spacer"></div>`;
  days.forEach(day => {
    const isToday = day.toDateString() === today.toDateString();
    const wd = cap(fmtWeekday(day), 3);
    const dn = day.getDate();
    const mo = day.toLocaleDateString('da-DK', { month: 'short' });
    html += `
      <div class="cal-day-header${isToday ? ' today' : ''}">
        <div style="font-size:11px;color:var(--muted)">${wd}</div>
        <div class="day-num" style="${isToday ? 'background:var(--primary);color:#fff;border-radius:50%;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;' : ''}">${dn}</div>
        <div style="font-size:11px;color:var(--muted)">${mo}</div>
      </div>`;
  });

  // === CAR ROWS ===
  if (enabledCars.length === 0) {
    html += `<div style="grid-column: 1/-1; text-align:center; padding: 40px; color:var(--muted);">
      Slå mindst én bil til for at se kalenderen.
    </div>`;
  }

  enabledCars.forEach(car => {
    // Car label
    html += `
      <div class="cal-car-label">
        <span class="car-dot" style="background:${car.color}"></span>
        <div>
          <div style="font-size:13px">${car.name}</div>
          <div style="font-size:11px;color:var(--muted)">${car.current_km.toLocaleString('da-DK')} km</div>
        </div>
      </div>`;

    // Day cells
    days.forEach(day => {
      const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
      const dayEnd   = new Date(day); dayEnd.setHours(23, 59, 59, 999);
      const isPast   = day < today;

      const dayBookings = state.bookings.filter(b =>
        b.car_id === car.id &&
        new Date(b.start_time) < dayEnd &&
        new Date(b.end_time) > dayStart
      );

      html += `<div class="day-cell${isPast ? ' past' : ''}"
        data-car-id="${car.id}"
        data-date="${day.toISOString()}">`;

      // Hour guide lines
      for (let h = DAY_START_H; h <= DAY_END_H; h += 2) {
        const p = pct(h * 60);
        html += `<div class="time-line" style="top:${p}%"></div>
                 <div class="time-label" style="top:${p}%">${String(h).padStart(2,'0')}</div>`;
      }

      // Booking blocks
      dayBookings.forEach(b => {
        const bStart = new Date(b.start_time);
        const bEnd   = new Date(b.end_time);
        const clampStart = Math.max(bStart.getHours() * 60 + bStart.getMinutes(), DAY_START_H * 60);
        const clampEnd   = Math.min(bEnd.getHours()   * 60 + bEnd.getMinutes(),   DAY_END_H   * 60);
        if (clampEnd <= clampStart) return;

        const topPct  = pct(clampStart);
        const heightPct = ((clampEnd - clampStart) / DAY_MINUTES) * 100;

        html += `
          <div class="booking-block"
            style="top:${topPct}%;height:${Math.max(heightPct, 3)}%;background:${car.color}80;border-left:3px solid ${car.color};"
            data-booking-id="${b.id}">
            <span style="color:${car.color}">${b.user_name}</span>
            <small style="color:${car.color}">${fmtTime(bStart)}–${fmtTime(bEnd)}</small>
          </div>`;
      });

      // "+" hint for free cells
      if (!isPast) html += `<div class="free-hint">+</div>`;

      html += `</div>`;
    });
  });

  grid.innerHTML = html;

  // Click on free cell area → open booking modal
  grid.querySelectorAll('.day-cell:not(.past)').forEach(cell => {
    cell.addEventListener('click', e => {
      if (e.target.closest('.booking-block')) return;

      const carId = cell.dataset.carId;
      const day   = new Date(cell.dataset.date);
      const rect  = cell.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const minutesFromStart = Math.round((ratio * DAY_MINUTES) / 15) * 15;
      const totalMinutes = DAY_START_H * 60 + minutesFromStart;
      day.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);

      openBookingModal(carId, day);
    });
  });

  // Click on booking block → show detail
  grid.querySelectorAll('.booking-block').forEach(block => {
    block.addEventListener('click', e => {
      e.stopPropagation();
      openDetailModal(block.dataset.bookingId);
    });
  });
}

// =============================================
// BOOKING MODAL
// =============================================
function openBookingModal(carId, suggestedStart) {
  const car = state.cars.find(c => c.id === carId);
  if (!car) return;

  const suggestedEnd = new Date(suggestedStart);
  suggestedEnd.setHours(suggestedEnd.getHours() + 1);

  document.getElementById('bm-car-badge').textContent = car.name;
  document.getElementById('bm-car-badge').style.background = car.color;
  document.getElementById('bm-car-id').value = carId;

  const currentKm = car.current_km || 0;
  const kmInput = document.getElementById('bm-start-km');
  kmInput.value = currentKm;
  kmInput.dataset.original = currentKm;
  document.getElementById('bm-km-warning').classList.add('hidden');

  document.getElementById('bm-start').value = toLocal(suggestedStart);
  document.getElementById('bm-end').value   = toLocal(suggestedEnd);
  document.getElementById('bm-name').value  = '';
  document.getElementById('bm-phone').value = '';
  document.getElementById('bm-exp-km').value = '';
  document.getElementById('bm-notes').value  = '';
  showError('bm-error', '');

  document.getElementById('booking-modal').classList.remove('hidden');
  document.getElementById('bm-name').focus();
}

document.getElementById('bm-start-km').addEventListener('input', function () {
  const original = parseInt(this.dataset.original, 10);
  const current  = parseInt(this.value, 10);
  const warn = document.getElementById('bm-km-warning');
  if (!isNaN(current) && current !== original) {
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
});

document.getElementById('bm-start').addEventListener('change', function () {
  const start = new Date(this.value);
  const endInput = document.getElementById('bm-end');
  const end = new Date(endInput.value);
  if (isNaN(end) || end <= start) {
    const newEnd = new Date(start);
    newEnd.setHours(newEnd.getHours() + 1);
    endInput.value = toLocal(newEnd);
  }
});

function closeBookingModal() {
  document.getElementById('booking-modal').classList.add('hidden');
}
document.getElementById('bm-close').addEventListener('click', closeBookingModal);
document.getElementById('bm-cancel').addEventListener('click', closeBookingModal);

document.getElementById('bm-submit').addEventListener('click', async () => {
  const carId    = document.getElementById('bm-car-id').value;
  const name     = document.getElementById('bm-name').value.trim();
  const phone    = document.getElementById('bm-phone').value.trim();
  const expKm    = parseInt(document.getElementById('bm-exp-km').value, 10);
  const startKm  = parseInt(document.getElementById('bm-start-km').value, 10);
  const origKm   = parseInt(document.getElementById('bm-start-km').dataset.original, 10);
  const startVal = document.getElementById('bm-start').value;
  const endVal   = document.getElementById('bm-end').value;
  const notes    = document.getElementById('bm-notes').value.trim();

  if (!name)              return showError('bm-error', 'Indtast dit navn.');
  if (!phone)             return showError('bm-error', 'Indtast dit telefonnummer.');
  if (!expKm || expKm < 0) return showError('bm-error', 'Indtast forventet antal km (skal være > 0).');
  if (!startVal || !endVal) return showError('bm-error', 'Vælg start- og sluttidspunkt.');

  const startTime = new Date(startVal);
  const endTime   = new Date(endVal);

  if (endTime <= startTime) return showError('bm-error', 'Sluttidspunkt skal være efter starttidspunkt.');
  if (startTime < new Date()) return showError('bm-error', 'Du kan ikke booke i fortiden.');

  if (bookingsOverlap(state.bookings, carId, startTime.toISOString(), endTime.toISOString())) {
    return showError('bm-error', 'Bilen er allerede optaget i dette tidsrum — vælg et andet tidspunkt.');
  }

  const btn = document.getElementById('bm-submit');
  btn.disabled = true;
  btn.textContent = 'Booker…';

  try {
    const created = await createBooking({
      car_id:       carId,
      user_name:    name,
      phone,
      expected_km:  expKm,
      start_km:     startKm,
      start_time:   startTime.toISOString(),
      end_time:     endTime.toISOString(),
      notes,
    });

    // Log km-ændring hvis brugeren ændrede start-km
    if (!isNaN(origKm) && startKm !== origKm) {
      await logActivity('km_override', carId, created.id, name, {
        suggested_km: origKm,
        entered_km: startKm,
        note: 'Bruger valgte en anden start km-stand end den registrerede',
      });
    }

    closeBookingModal();
    toast(`Booking oprettet for ${state.cars.find(c => c.id === carId)?.name}`, 'success');
    await loadBookings();
    renderCalendarGrid();
  } catch (err) {
    showError('bm-error', err.message || 'Kunne ikke oprette booking. Prøv igen.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Book bil';
  }
});

// =============================================
// DETAIL MODAL
// =============================================
async function openDetailModal(bookingId) {
  const b = state.bookings.find(x => x.id === bookingId)
    || (await db.from('bookings').select('*, cars(name,color)').eq('id', bookingId).single()).data;

  if (!b) return;
  const car = b.cars || state.cars.find(c => c.id === b.car_id);

  document.getElementById('dm-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
      <span class="car-badge" style="background:${car.color}">${car.name}</span>
    </div>
    <div class="dm-row"><label>Booket af</label><span>${b.user_name}</span></div>
    <div class="dm-row"><label>Telefon</label><span>${b.phone}</span></div>
    <div class="dm-row"><label>Periode</label>
      <span>${fmtDateTime(b.start_time)} → ${fmtDateTime(b.end_time)}</span></div>
    <div class="dm-row"><label>Start km</label><span>${b.start_km.toLocaleString('da-DK')} km</span></div>
    <div class="dm-row"><label>Forventet km</label><span>${b.expected_km} km</span></div>
    ${b.notes ? `<div class="dm-row"><label>Bemærkninger</label><span>${b.notes}</span></div>` : ''}
    <div class="dm-row"><label>Oprettet</label><span>${fmtDateTime(b.created_at)}</span></div>
  `;

  document.getElementById('dm-cancel-booking').dataset.bookingId = bookingId;
  document.getElementById('detail-modal').classList.remove('hidden');
}

document.getElementById('dm-close').addEventListener('click', () => {
  document.getElementById('detail-modal').classList.add('hidden');
});
document.getElementById('dm-close-btn').addEventListener('click', () => {
  document.getElementById('detail-modal').classList.add('hidden');
});

document.getElementById('dm-cancel-booking').addEventListener('click', async function () {
  if (!confirm('Er du sikker på, at du vil annullere denne booking?')) return;
  try {
    await cancelBooking(this.dataset.bookingId);
    document.getElementById('detail-modal').classList.add('hidden');
    toast('Booking annulleret', 'info');
    await loadBookings();
    renderCalendarGrid();
  } catch (err) {
    toast('Fejl: ' + err.message, 'error');
  }
});

// =============================================
// DELIVERY VIEW
// =============================================
async function initDeliveryView() {
  const carSel = document.getElementById('del-car');
  carSel.innerHTML = `<option value="">Vælg bil…</option>` +
    state.cars.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  // Hours select: 0-48
  const hourSel = document.getElementById('del-hours');
  hourSel.innerHTML = Array.from({ length: 49 }, (_, i) =>
    `<option value="${i}">${i} time${i !== 1 ? 'r' : ''}</option>`).join('');

  document.getElementById('del-end-km').addEventListener('input', updateKmDriven);
  document.getElementById('del-booking').addEventListener('change', updateBookingInfo);
  carSel.addEventListener('change', loadCarBookings);
}

async function loadCarBookings() {
  const carId = document.getElementById('del-car').value;
  const row   = document.getElementById('del-booking-row');
  const info  = document.getElementById('del-booking-info');

  if (!carId) { row.classList.add('hidden'); info.classList.add('hidden'); return; }

  const bookings = await loadAllBookingsForCar(carId);
  const sel = document.getElementById('del-booking');

  if (bookings.length === 0) {
    row.classList.add('hidden');
    info.innerHTML = 'Ingen aktive bookinger for denne bil.';
    info.classList.remove('hidden');
    return;
  }

  sel.innerHTML = `<option value="">Ingen specifik booking</option>` +
    bookings.map(b => `<option value="${b.id}">${b.user_name} — ${fmtDateTime(b.start_time)}</option>`).join('');
  row.classList.remove('hidden');
  info.classList.add('hidden');
  updateBookingInfo();
}

function updateBookingInfo() {
  const bookingId = document.getElementById('del-booking').value;
  const info = document.getElementById('del-booking-info');

  if (!bookingId) { info.classList.add('hidden'); return; }

  const allBookings = state.bookings;
  // Find in state or do a fresh lookup
  const b = allBookings.find(x => x.id === bookingId);
  if (!b) { info.classList.add('hidden'); return; }

  info.innerHTML = `
    <strong>${b.user_name}</strong> &mdash; ${b.phone}<br>
    ${fmtDateTime(b.start_time)} → ${fmtDateTime(b.end_time)}<br>
    Start km: ${b.start_km.toLocaleString('da-DK')} &nbsp;|&nbsp; Forventet: ${b.expected_km} km
  `;
  info.classList.remove('hidden');

  // Pre-fill km-stand
  document.getElementById('del-end-km').value = '';
  updateKmDriven();
}

function updateKmDriven() {
  const bookingId = document.getElementById('del-booking').value;
  const endKm = parseInt(document.getElementById('del-end-km').value, 10);
  const driven = document.getElementById('del-km-driven');

  if (!bookingId || isNaN(endKm)) { driven.value = ''; return; }

  // Find start_km from loaded bookings
  const allBookings = [
    ...state.bookings,
  ];
  const b = allBookings.find(x => x.id === bookingId);
  if (b && !isNaN(b.start_km)) {
    const km = endKm - b.start_km;
    driven.value = km >= 0 ? km : '';
  }
}

document.getElementById('del-submit').addEventListener('click', async () => {
  const carId    = document.getElementById('del-car').value;
  const bookingId = document.getElementById('del-booking').value;
  const hours    = parseInt(document.getElementById('del-hours').value, 10);
  const quarters = parseInt(document.getElementById('del-minutes').value, 10);
  const endKm    = parseInt(document.getElementById('del-end-km').value, 10);
  const comments = document.getElementById('del-comments').value.trim();

  if (!carId) return showError('del-error', 'Vælg en bil.');
  if (isNaN(endKm) || endKm < 0) return showError('del-error', 'Indtast en gyldig km-stand.');

  const durationQuarters = hours * 4 + quarters;
  if (durationQuarters === 0) return showError('del-error', 'Angiv den tid bilen har været brugt.');

  // Find the booking to get start_km
  let startKm = 0;
  const booking = bookingId
    ? (state.bookings.find(b => b.id === bookingId)
      || (await db.from('bookings').select('*').eq('id', bookingId).single()).data)
    : null;

  if (booking) {
    startKm = booking.start_km;
    if (endKm < startKm) return showError('del-error', `Aflæst km-stand (${endKm}) er lavere end start km-stand (${startKm}).`);
  }

  const btn = document.getElementById('del-submit');
  btn.disabled = true;
  btn.textContent = 'Registrerer…';

  try {
    const { data: delivery, error } = await db.from('deliveries').insert({
      booking_id: bookingId || null,
      car_id: carId,
      start_km: startKm,
      end_km: endKm,
      duration_quarters: durationQuarters,
      comments,
    }).select().single();

    if (error) throw error;

    // Update car's current km
    await db.from('cars').update({ current_km: endKm }).eq('id', carId);

    // Mark booking as completed
    if (bookingId) {
      await db.from('bookings').update({ status: 'completed' }).eq('id', bookingId);
    }

    const car = state.cars.find(c => c.id === carId);
    const km = endKm - startKm;
    const durText = `${hours}t ${quarters > 0 ? quarters * 15 + 'min' : ''}`.trim();

    await logActivity('aflevering', carId, bookingId || null, booking?.user_name || null, {
      end_km: endKm,
      start_km: startKm,
      km_driven: km,
      duration_quarters: durationQuarters,
      duration_text: durText,
      comments,
    });

    toast(`${car?.name || 'Bil'} afleveret. ${km} km kørt.`, 'success');

    // Reset form
    document.getElementById('del-car').value = '';
    document.getElementById('del-booking').value = '';
    document.getElementById('del-end-km').value = '';
    document.getElementById('del-km-driven').value = '';
    document.getElementById('del-comments').value = '';
    document.getElementById('del-hours').value = '0';
    document.getElementById('del-minutes').value = '0';
    document.getElementById('del-booking-row').classList.add('hidden');
    document.getElementById('del-booking-info').classList.add('hidden');
    showError('del-error', '');

    // Refresh state
    await loadCars();
    await loadBookings();
    renderCalendarGrid();
    renderCarToggles();

  } catch (err) {
    showError('del-error', err.message || 'Fejl ved registrering. Prøv igen.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Registrer aflevering';
  }
});

// =============================================
// LOG VIEW
// =============================================
async function loadLog() {
  const carFilter    = document.getElementById('log-filter-car').value;
  const actionFilter = document.getElementById('log-filter-action').value;

  let query = db.from('activity_log')
    .select('*, cars(name, color)')
    .order('created_at', { ascending: false })
    .limit(200);

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
    const details = formatLogDetails(row.action_type, row.details);
    return `
      <tr>
        <td style="white-space:nowrap;color:var(--muted)">${fmtDateTime(row.created_at)}</td>
        <td><span class="badge ${badge.cls}">${badge.label}</span></td>
        <td>${car ? `<span style="display:inline-flex;align-items:center;gap:5px;">
          <span class="car-dot" style="background:${car.color};width:8px;height:8px;border-radius:50%;display:inline-block"></span>
          ${car.name}</span>` : '–'}</td>
        <td>${row.user_name || '–'}</td>
        <td class="log-details">${details}</td>
      </tr>`;
  }).join('');
}

function actionBadge(type) {
  const map = {
    booking_oprettet:  { label: 'Booking oprettet',  cls: 'badge-blue'   },
    booking_annulleret:{ label: 'Booking annulleret', cls: 'badge-red'    },
    booking_aendret:   { label: 'Booking ændret',     cls: 'badge-yellow' },
    aflevering:        { label: 'Aflevering',         cls: 'badge-green'  },
    km_override:       { label: 'KM ændret',          cls: 'badge-yellow' },
    bil_oprettet:      { label: 'Bil oprettet',       cls: 'badge-purple' },
    bil_slettet:       { label: 'Bil slettet',        cls: 'badge-red'    },
    bil_aendret:       { label: 'Bil ændret',         cls: 'badge-gray'   },
  };
  return map[type] || { label: type, cls: 'badge-gray' };
}

function formatLogDetails(type, d) {
  if (!d) return '';
  try {
    if (type === 'booking_oprettet') {
      return `${fmtDateTime(d.start_time)} → ${fmtDateTime(d.end_time)}, start km: ${d.start_km?.toLocaleString('da-DK')}`;
    }
    if (type === 'booking_annulleret') {
      return `${fmtDateTime(d.start_time)} → ${fmtDateTime(d.end_time)}`;
    }
    if (type === 'aflevering') {
      return `${d.km_driven} km kørt, ${d.duration_text || d.duration_quarters + ' kvt.'}, slut km: ${d.end_km?.toLocaleString('da-DK')}${d.comments ? ` — ${d.comments}` : ''}`;
    }
    if (type === 'km_override') {
      return `Foreslået: ${d.suggested_km?.toLocaleString('da-DK')} km → Indtastet: ${d.entered_km?.toLocaleString('da-DK')} km`;
    }
    if (type === 'bil_aendret') {
      return Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(', ');
    }
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
  const pw = document.getElementById('admin-pw').value;
  if (pw === ADMIN_PASSWORD) {
    document.getElementById('admin-gate').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    state.adminUnlocked = true;
    renderAdminCars();
    loadAdminBookings();
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
        <div>
          <strong>${car.name}</strong>
          <small style="display:block">${car.current_km.toLocaleString('da-DK')} km</small>
        </div>
      </div>
      <div class="car-actions">
        <button class="btn-icon" data-action="edit" data-car-id="${car.id}">&#9998; Rediger</button>
        <button class="btn-icon danger" data-action="delete" data-car-id="${car.id}">&#128465; Slet</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openEditCarModal(btn.dataset.carId));
  });
  list.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteCarPrompt(btn.dataset.carId));
  });
}

async function loadAdminBookings() {
  const { data } = await db
    .from('bookings')
    .select('*, cars(name, color)')
    .eq('status', 'active')
    .gte('end_time', new Date().toISOString())
    .order('start_time')
    .limit(20);

  const container = document.getElementById('admin-bookings');
  if (!data || !data.length) {
    container.innerHTML = '<p style="color:var(--muted)">Ingen kommende bookinger.</p>';
    return;
  }

  container.innerHTML = data.map(b => {
    const car = b.cars;
    return `
      <div class="booking-admin-row">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
          <span class="car-dot" style="background:${car?.color};width:8px;height:8px;border-radius:50%;display:inline-block"></span>
          <strong>${car?.name}</strong>
          <span style="color:var(--muted)">— ${b.user_name}</span>
        </div>
        <div style="color:var(--muted)">${fmtDateTime(b.start_time)} → ${fmtDateTime(b.end_time)}</div>
      </div>`;
  }).join('');
}

document.getElementById('new-car-btn').addEventListener('click', async () => {
  const name  = document.getElementById('new-car-name').value.trim();
  const color = document.getElementById('new-car-color').value;
  const km    = parseInt(document.getElementById('new-car-km').value, 10) || 0;

  if (!name) return showError('new-car-error', 'Indtast et navn til bilen.');

  try {
    const { data, error } = await db.from('cars').insert({ name, color, current_km: km }).select().single();
    if (error) throw error;

    await logActivity('bil_oprettet', data.id, null, null, { name, color, km });

    toast(`${name} tilføjet`, 'success');
    document.getElementById('new-car-name').value = '';
    document.getElementById('new-car-km').value = '0';
    showError('new-car-error', '');

    await loadCars();
    renderAdminCars();
    renderCarToggles();
    renderCalendarGrid();
  } catch (err) {
    showError('new-car-error', err.message);
  }
});

// Edit car modal
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

document.getElementById('ecm-close').addEventListener('click', () => {
  document.getElementById('edit-car-modal').classList.add('hidden');
});
document.getElementById('ecm-cancel').addEventListener('click', () => {
  document.getElementById('edit-car-modal').classList.add('hidden');
});

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

    if (Object.keys(changes).length) {
      await logActivity('bil_aendret', carId, null, null, changes);
    }

    document.getElementById('edit-car-modal').classList.add('hidden');
    toast(`${name} opdateret`, 'success');
    await loadCars();
    renderAdminCars();
    renderCarToggles();
    renderCalendarGrid();
  } catch (err) {
    showError('ecm-error', err.message);
  }
});

async function deleteCarPrompt(carId) {
  const car = state.cars.find(c => c.id === carId);
  if (!confirm(`Er du sikker på, at du vil slette "${car?.name}"?\n\nAlle bookinger for denne bil vil også blive slettet.`)) return;

  try {
    const { error } = await db.from('cars').update({ active: false }).eq('id', carId);
    if (error) throw error;

    await logActivity('bil_slettet', carId, null, null, { name: car?.name });

    toast(`${car?.name} er slettet`, 'info');
    state.enabledCars.delete(carId);
    await loadCars();
    renderAdminCars();
    renderCarToggles();
    renderCalendarGrid();
  } catch (err) {
    toast('Fejl: ' + err.message, 'error');
  }
}

// =============================================
// HELPERS
// =============================================
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
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

  if (view === 'log') loadLog();
  if (view === 'delivery') initDeliveryView();
  if (view === 'admin' && state.adminUnlocked) { renderAdminCars(); loadAdminBookings(); }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

document.getElementById('prev-week').addEventListener('click', async () => {
  state.weekStart = addDays(state.weekStart, -7);
  renderWeekLabel();
  await loadBookings();
  renderCalendarGrid();
});

document.getElementById('next-week').addEventListener('click', async () => {
  state.weekStart = addDays(state.weekStart, 7);
  renderWeekLabel();
  await loadBookings();
  renderCalendarGrid();
});

document.getElementById('today-btn').addEventListener('click', async () => {
  state.weekStart = getMonday(new Date());
  renderWeekLabel();
  await loadBookings();
  renderCalendarGrid();
});

// Close modals on overlay click
['booking-modal', 'detail-modal', 'edit-car-modal'].forEach(id => {
  document.getElementById(id).addEventListener('click', function (e) {
    if (e.target === this) this.classList.add('hidden');
  });
});

// =============================================
// INIT
// =============================================
async function init() {
  try {
    await loadCars();
    await loadBookings();
    renderCalendar();
    initLogFilters();
  } catch (err) {
    console.error('Init error:', err);
    toast('Kunne ikke forbinde til databasen. Tjek din forbindelse.', 'error', 8000);
  }
}

document.addEventListener('DOMContentLoaded', init);
