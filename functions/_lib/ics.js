// iCalendar helpers: .ics attachments for invites and a subscribable feed for Imani.

const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line) => {
  const out = [];
  let l = line;
  while (l.length > 74) { out.push(l.slice(0, 74)); l = ' ' + l.slice(74); }
  out.push(l);
  return out.join('\r\n');
};

export function vevent({ uid, start, minutes, title, description = '', url = '', location = '', sequence = 0, status = 'CONFIRMED', organizer }) {
  const end = new Date(new Date(start).getTime() + minutes * 60000);
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SEQUENCE:${sequence}`,
    `STATUS:${status}`,
    `SUMMARY:${esc(title)}`,
    description && `DESCRIPTION:${esc(description)}`,
    (location || url) && `LOCATION:${esc(location || url)}`,
    url && `URL:${esc(url)}`,
    organizer && `ORGANIZER;CN=${esc(organizer.name)}:mailto:${organizer.email}`,
    status !== 'CANCELLED' && 'BEGIN:VALARM', status !== 'CANCELLED' && 'TRIGGER:-PT60M',
    status !== 'CANCELLED' && 'ACTION:DISPLAY', status !== 'CANCELLED' && `DESCRIPTION:${esc(title)}`,
    status !== 'CANCELLED' && 'END:VALARM',
    'END:VEVENT',
  ].filter(Boolean).map(fold).join('\r\n');
}

export function calendar(events, { method, name } = {}) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HBDYWI//Reader Funnel//EN', 'CALSCALE:GREGORIAN',
    method && `METHOD:${method}`, name && `X-WR-CALNAME:${esc(name)}`,
    ...events, 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n') + '\r\n';
}

export function icsAttachment(ev, method = 'PUBLISH') {
  const text = calendar([vevent(ev)], { method });
  return { filename: 'invite.ics', content: btoa(unescape(encodeURIComponent(text))), content_type: 'text/calendar' };
}
