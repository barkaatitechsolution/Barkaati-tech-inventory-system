// Attendance clock times.
//
// These are display-only. Whether someone is paid for a day comes from the
// status (present / half day / leave / absent) in payroll.js, never from the
// hours here -- the shopkeeper picks the status by hand, so a mistyped clock
// time can never quietly change someone's pay.

const MINUTES_PER_DAY = 24 * 60;

export function minutesOf(value) {
  if (value === null || value === undefined) return null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function workedHours(timeIn, timeOut) {
  const from = minutesOf(timeIn);
  const to = minutesOf(timeOut);
  if (from === null || to === null) return null;
  let diff = to - from;
  if (diff < 0) diff += MINUTES_PER_DAY;
  return diff / 60;
}

export function fmtHours(hours) {
  if (hours === null || hours === undefined) return "—";
  const total = Math.round(Number(hours) * 60);
  if (!Number.isFinite(total) || total <= 0) return "0h";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export function arrivalGap(timeIn, shiftStart) {
  const from = minutesOf(timeIn);
  const shift = minutesOf(shiftStart);
  if (from === null || shift === null) return null;
  return from - shift;
}

export function arrivalLabel(timeIn, shiftStart) {
  const gap = arrivalGap(timeIn, shiftStart);
  if (gap === null) return null;
  if (gap > 0) return `Late ${fmtHours(gap / 60)}`;
  if (gap < 0) return `Early ${fmtHours(-gap / 60)}`;
  return "On time";
}

const pad2h = (n) => String(n).padStart(2, "0");

export function timeDigits(text) {
  return String(text || "").replace(/\D/g, "").slice(0, 4);
}

export function normalizeTime(text) {
  const d = timeDigits(text);
  if (!d) return "";
  if (d.length < 3) return null;
  const h = d.length === 3 ? Number(d[0]) : Number(d.slice(0, 2));
  const m = Number(d.slice(-2));
  if (h > 23 || m > 59) return null;
  return `${pad2h(h)}:${pad2h(m)}`;
}

export function timeOptions(shiftStart, shiftEnd, { pad = 90, step = 15 } = {}) {
  const from = minutesOf(shiftStart);
  const to = minutesOf(shiftEnd);
  const startM = (from === null ? 6 * 60 : from) - pad;
  let endM = (to === null ? 22 * 60 : to) + pad;

  if (endM <= startM) endM += MINUTES_PER_DAY;

  const out = [];
  const seen = new Set();
  for (let m = Math.max(0, startM); m <= endM; m += step) {
    const wrapped = m % MINUTES_PER_DAY;
    const t = `${pad2h(Math.floor(wrapped / 60))}:${pad2h(wrapped % 60)}`;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.sort();
}
