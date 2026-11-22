// Time-zone math using only Intl (works in Workers, Node and browsers).

const pad = (n) => String(n).padStart(2, '0');

/** Wall-clock parts of `date` in time zone `tz`. weekday: 0=Sun..6=Sat */
export function wallParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second, weekday: wd };
}

/** Offset (minutes) of tz from UTC at instant `date`. PST → -480 */
export function tzOffset(date, tz) {
  const p = wallParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Convert a wall-clock time in `tz` to a UTC Date (DST-safe). */
export function zonedToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffset(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffset(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

/** Days (1..31) of month that are the nth `weekday` (nths: [2,4]; -1 = last). */
export function nthWeekdays(y, m, weekday, nths) {
  const days = [];
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === weekday) days.push(d);
  return nths.map((n) => (n === -1 ? days[days.length - 1] : days[n - 1])).filter(Boolean);
}

/** Activation dates from a rule like {weekdays:[3], nth:[2,4], time:'17:00'} */
export function activationDates(rule, tz, from = new Date(), months = 3) {
  const [hh, mm] = (rule.time || '17:00').split(':').map(Number);
  const start = wallParts(from, tz);
  const out = [];
  for (let i = 0; i <= months; i++) {
    const y = start.y + Math.floor((start.m - 1 + i) / 12);
    const m = ((start.m - 1 + i) % 12) + 1;
    for (const wd of rule.weekdays || [3]) {
      for (const d of nthWeekdays(y, m, wd, rule.nth || [2, 4])) {
        const dt = zonedToUtc(y, m, d, hh, mm, tz);
        if (dt > from) out.push(dt);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

export function formatWhen(iso, tz, { withTz = true, dateOnly = false } = {}) {
  const date = new Date(iso);
  const opts = dateOnly
    ? { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    : { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', ...(withTz ? { timeZoneName: 'short' } : {}) };
  return new Intl.DateTimeFormat('en-US', opts).format(date);
}

export const dateKey = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

/** Monday-based week key in tz, for max-visits-per-week */
export function weekKey(date, tz) {
  const p = wallParts(date, tz);
  const local = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const back = (p.weekday + 6) % 7;
  local.setUTCDate(local.getUTCDate() - back);
  return local.toISOString().slice(0, 10);
}

/**
 * Available author-visit slots.
 * cfg: settings.visit  {timezone, weekly:{"1":[["10:00","16:00"]]}, duration_min, buffer_min, min_notice_hours, window_days, max_per_week}
 * booked: [{starts_at, duration_min}]  (other groups' booked visits)
 * blackouts: ['2027-01-01', ...] dates in author tz
 * calendarBusy: [{start, end}] busy blocks from Imani's Google Calendar (any event she blocks out)
 */
export function visitSlots(cfg, booked = [], blackouts = [], now = new Date(), calendarBusy = []) {
  const tz = cfg.timezone || 'America/Los_Angeles';
  const dur = cfg.duration_min || 30;
  const buf = cfg.buffer_min ?? 15;
  const earliest = now.getTime() + (cfg.min_notice_hours ?? 48) * 3600000;
  const latest = now.getTime() + (cfg.window_days ?? 60) * 86400000;
  const black = new Set(blackouts);
  const busy = booked.map((b) => {
    const s = new Date(b.starts_at).getTime();
    return [s - buf * 60000, s + (b.duration_min || dur) * 60000 + buf * 60000];
  });
  for (const c of calendarBusy) {
    const a = new Date(c.start).getTime(), b = new Date(c.end).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) busy.push([a - buf * 60000, b + buf * 60000]);
  }
  const perWeek = {};
  for (const b of booked) { const k = weekKey(new Date(b.starts_at), tz); perWeek[k] = (perWeek[k] || 0) + 1; }
  const max = cfg.max_per_week || Infinity;

  const slots = [];
  const today = wallParts(now, tz);
  for (let i = 0; i <= (cfg.window_days ?? 60) + 1; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const key = `${y}-${pad(m)}-${pad(d)}`;
    if (black.has(key)) continue;
    const windows = (cfg.weekly || {})[String(day.getUTCDay())] || [];
    for (const [from, to] of windows) {
      const [fh, fm] = from.split(':').map(Number);
      const [th, tm] = to.split(':').map(Number);
      const winEnd = zonedToUtc(y, m, d, th, tm, tz).getTime();
      let t = zonedToUtc(y, m, d, fh, fm, tz).getTime();
      while (t + dur * 60000 <= winEnd) {
        if (t >= earliest && t <= latest) {
          const clash = busy.some(([a, b]) => t < b && t + dur * 60000 > a);
          const wk = weekKey(new Date(t), tz);
          if (!clash && (perWeek[wk] || 0) < max) slots.push(new Date(t).toISOString());
        }
        t += (dur + buf) * 60000;
      }
    }
  }
  return slots;
}

/** Reminder instants for an event; drops any that already passed (late signups). */
export function reminderTimes(startIso, hoursList, now = new Date(), graceMin = 5) {
  const start = new Date(startIso).getTime();
  return hoursList
    .map((h) => ({ hours: h, at: new Date(start - h * 3600000) }))
    .filter((r) => r.at.getTime() > now.getTime() - graceMin * 60000 && start > now.getTime());
}

export const hoursLabel = (h) => (h >= 48 ? 'in 2 days' : h >= 24 ? 'tomorrow' : h >= 2 ? `in ${h} hours` : 'in 1 hour');
