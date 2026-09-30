#!/usr/bin/env node
// Sender kalenderinvitationer via SMTP.
// Lytter på 127.0.0.1:3001. Nginx skal sende /api/calendar-invite hertil:
//   location /api/calendar-invite {
//     proxy_pass http://127.0.0.1:3001/api/calendar-invite;
//   }

import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const HOST = process.env.CALENDAR_MAIL_HOST || '127.0.0.1';
const PORT = Number(process.env.CALENDAR_MAIL_PORT || 3001);

function icsStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('Ugyldigt tidspunkt');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function calendarLinks({ summary, description, location, start, end }) {
  const when = `${icsStamp(start)}/${icsStamp(end)}`;
  const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE',
    text: summary || 'Booking',
    dates: when,
    details: description || '',
    location: location || 'Stamplads',
  }).toString();
  const outlook = 'https://outlook.live.com/calendar/0/deeplink/compose?' + new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: summary || 'Booking',
    startdt: new Date(start).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    enddt: new Date(end).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    body: description || '',
    location: location || 'Stamplads',
  }).toString();
  return { google, outlook };
}

export function buildIcs({ summary, description, location, start, end, uid }) {
  const esc = (value) => String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\n|\r/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Delebilsklub//Booking//DA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${esc(uid || `${icsStamp(new Date().toISOString())}@bilbooking`)}`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${esc(summary || 'Booking')}`,
    `DESCRIPTION:${esc(description || '')}`,
    `LOCATION:${esc(location || 'Stamplads')}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function icsLink(event) {
  const origin = process.env.CALENDAR_PUBLIC_ORIGIN || 'https://bilklub.club';
  return origin + '/api/calendar-invite?' + new URLSearchParams({
    ics: '1',
    text: event.summary || 'Booking',
    start: event.start,
    end: event.end,
    location: event.location || 'Stamplads',
    details: event.description || '',
    uid: event.uid || '',
  }).toString();
}

function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

export function buildPlainMessage({ from, to, subject, text }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const raw = `${headers.join('\n')}\n\n${text}\n`;
  const stuffed = raw.replace(/^\./gm, '..');
  return stuffed.replace(/\n/g, '\r\n');
}

export function buildMessage({ from, to, subject, text, html }) {
  const boundary = `bilbooking-${Date.now().toString(16)}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  const raw = `${headers.join('\n')}\n\n${body.replace(/\r\n/g, '\n')}`;
  const stuffed = raw.replace(/^\./gm, '..');
  return stuffed.replace(/\n/g, '\r\n');
}

function readSmtp(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('SMTP-serveren svarede ikke'));
    }, 20000);
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r?\n/).filter((l) => l.length);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        cleanup();
        resolve({ code: Number(last.slice(0, 3)), text: lines.join('\n') });
      }
    };
    const onError = (err) => { cleanup(); reject(err); };
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    }
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function command(socket, line, ok) {
  socket.write(`${line}\r\n`);
  const res = await readSmtp(socket);
  if (!ok.includes(res.code)) {
    throw new Error(`SMTP ${res.code}: ${res.text.replace(/\s+/g, ' ').slice(0, 180)}`);
  }
  return res;
}

export async function sendSmtp({ host, port, user, pass, from, to, raw }) {
  const secure = Number(port) === 465;
  const socket = await new Promise((resolve, reject) => {
    const onErr = (err) => reject(err);
    const s = secure
      ? tls.connect({ host, port: Number(port), servername: host }, () => resolve(s))
      : net.connect(Number(port), host, () => resolve(s));
    s.once('error', onErr);
  });
  socket.setTimeout(20000);
  try {
    let greet = await readSmtp(socket);
    if (greet.code !== 220) throw new Error(`SMTP ${greet.code}`);
    let ehlo = await command(socket, 'EHLO bilbooking', [250]);
    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      await command(socket, 'STARTTLS', [220]);
      const tlsSocket = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: host }, () => resolve(t));
        t.once('error', reject);
      });
      socket.removeAllListeners();
      await command(tlsSocket, 'EHLO bilbooking', [250]);
      return await finish(tlsSocket, { user, pass, from, to, raw });
    }
    return await finish(socket, { user, pass, from, to, raw });
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

async function finish(socket, { user, pass, from, to, raw }) {
  try {
    if (user) {
      const token = Buffer.from(`\0${user}\0${pass || ''}`, 'utf8').toString('base64');
      await command(socket, `AUTH PLAIN ${token}`, [235]);
    }
    await command(socket, `MAIL FROM:<${from}>`, [250]);
    await command(socket, `RCPT TO:<${to}>`, [250, 251]);
    await command(socket, 'DATA', [354]);
    socket.write(`${raw}\r\n.\r\n`);
    const sent = await readSmtp(socket);
    if (sent.code !== 250) throw new Error(`SMTP ${sent.code}: ${sent.text.slice(0, 180)}`);
    socket.write('QUIT\r\n');
    socket.end();
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

async function sendTestMail(res, { smtp, from, to }) {
  if (!validEmail(to) || !validEmail(from)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Udfyld en gyldig afsender. Modtager bruges kun, hvis den er udfyldt.' }));
    return;
  }
  if (!smtp.host) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'SMTP er ikke udfyldt under Indstillinger.' }));
    return;
  }
  try {
    const raw = buildPlainMessage({
      from,
      to,
      subject: 'Test fra bilklub.club',
      text: 'Dette er en testmail fra bookingsystemet. SMTP-indstillingerne virker.',
    });
    await sendSmtp({
      host: smtp.host,
      port: Number(smtp.port) || 587,
      user: smtp.user || '',
      pass: String(smtp.pass || '').replace(/\s+/g, ''),
      from,
      to,
      raw,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Kunne ikke sende mail' }));
  }
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function sendIcs(res, params) {
  const start = params.get('start') || '';
  const end = params.get('end') || '';
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end('Ugyldigt tidspunkt');
    return;
  }
  const ics = buildIcs({
    summary: (params.get('text') || 'Booking').slice(0, 200),
    description: (params.get('details') || '').slice(0, 2000),
    location: (params.get('location') || 'Stamplads').slice(0, 200),
    start,
    end,
    uid: (params.get('uid') || '').slice(0, 200),
  });
  res.writeHead(200, {
    'Content-Type': 'text/calendar; charset=UTF-8; method=PUBLISH',
    'Content-Disposition': 'inline; filename="booking.ics"',
  });
  res.end(ics);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathName = url.pathname;
  if (pathName !== '/api/calendar-invite' && pathName !== '/calendar-invite') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ikke fundet' }));
    return;
  }
  if (req.method === 'GET' && url.searchParams.get('ics') === '1') {
    sendIcs(res, url.searchParams);
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ikke fundet' }));
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ugyldig forespørgsel' }));
    return;
  }
  const smtp = body.smtp || {};
  const from = String(smtp.from || '').trim();
  const to = String(body.to || (body.test ? from : '')).trim();
  if (body.test) {
    await sendTestMail(res, { smtp, from, to });
    return;
  }
  if (!validEmail(to) || !validEmail(from)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Mailadresse mangler. Udfyld afsender under Indstillinger og modtager på brugeren.' }));
    return;
  }
  if (!smtp.host) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'SMTP er ikke udfyldt under Indstillinger.' }));
    return;
  }
  try {
    const cancelled = body.status === 'cancelled';
    const summary = body.summary || 'Booking';
    const description = body.description || summary;
    const location = body.location || 'Stamplads';
    const links = cancelled ? null : {
      ...calendarLinks({ summary, description, location, start: body.start, end: body.end }),
      ics: icsLink({ summary, description, location, start: body.start, end: body.end, uid: `${body.bookingId || 'booking'}@bilbooking` }),
    };
    const subject = cancelled ? `Aflyst: ${summary}` : summary;
    const button = (href, label, color) => `<a href="${htmlEscape(href)}" style="display:inline-block;background:${color};color:#ffffff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:600;margin:0 8px 8px 0">${htmlEscape(label)}</a>`;
    const text = cancelled
      ? `${description}\n\nBookingen er aflyst. Slet den i din kalender, hvis du har tilføjet den.`
      : `${description}\n\nGoogle Kalender:\n${links.google}\n\nOutlook:\n${links.outlook}\n\nApple, Windows eller en anden kalender:\n${links.ics}`;
    const html = cancelled
      ? `<p>${htmlEscape(description).replace(/\n/g, '<br>')}</p><p>Bookingen er aflyst. Slet den i din kalender, hvis du har tilføjet den.</p>`
      : `<p>${htmlEscape(description).replace(/\n/g, '<br>')}</p>
<p>Vælg den kalender, du bruger:</p>
<p>${button(links.google, 'Google Kalender', '#1a73e8')}${button(links.outlook, 'Outlook', '#0f6cbd')}${button(links.ics, 'Apple / anden kalender', '#374151')}</p>`;
    const raw = buildMessage({ from, to, subject, text, html });
    await sendSmtp({
      host: smtp.host,
      port: Number(smtp.port) || 587,
      user: smtp.user || '',
      pass: String(smtp.pass || '').replace(/\s+/g, ''),
      from,
      to,
      raw,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Kunne ikke sende mail' }));
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  http.createServer(handle).listen(PORT, HOST, () => {
    console.log(`calendar-mail lytter på http://${HOST}:${PORT}`);
  });
}
