// Attendance clock times.
//
// These are display-only. Whether someone is paid for a day comes from the
// status (present / half day / leave / absent) in payroll.js, never from the
// hours here -- the shopkeeper picks the status by hand, so a mistyped clock
// time can never quietly change someone's pay.

const MINUTES_PER_DAY = 24 * 60;

// Accepts "HH:MM" from <input type="time"> and "HH:MM:SS" as Postgres returns a
// TIME column, so both callers can pass their value straight through.
export function minutesOf(value) {
  if (value === null || value === undefined) return null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Hours worked between a clock-in and a clock-out, as a decimal.
//
// A shop shift can run past midnight, so an out time earlier than the in time
// means the person worked overnight: 22:00 -> 06:00 is 8 hours, not minus 16.
// That rollover is assumed rather than flagged, because a night shift is a real
// shift and reporting a negative day would be nonsense.
//
// Returns null when either time is missing or unparseable -- half a pair cannot
// be turned into hours, and the caller shows a dash rather than a wrong number.
export function workedHours(timeIn, timeOut) {
  const from = minutesOf(timeIn);
  const to = minutesOf(timeOut);
  if (from === null || to === null) return null;
  let diff = to - from;
  if (diff < 0) diff += MINUTES_PER_DAY;
  return diff / 60;
}

// "8h", "8h 30m", "45m" -- reads faster than "8.5" on a shop floor.
export function fmtHours(hours) {
  if (hours === null || hours === undefined) return "—";
  const total = Math.round(Number(hours) * 60);
  if (!Number.isFinite(total) || total <= 0) return "0h";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// How far the clock-in sits from the employee's shift start. Positive minutes
// means late, negative means they came in early. Null when the employee has no
// shift set or has not clocked in, since there is nothing to compare against.
export function arrivalGap(timeIn, shiftStart) {
  const from = minutesOf(timeIn);
  const shift = minutesOf(shiftStart);
  if (from === null || shift === null) return null;
  return from - shift;
}

// A short label for the arrival comparison, e.g. "Late 25m", "Late 13h",
// "Early 10m", "On time". Only the clock-in is compared -- departure is left to
// the status. The gap is formatted as a duration so a big lateness reads
// "Late 13h" rather than "Late 780m".
export function arrivalLabel(timeIn, shiftStart) {
  const gap = arrivalGap(timeIn, shiftStart);
  if (gap === null) return null;
  if (gap > 0) return `Late ${fmtHours(gap / 60)}`;
  if (gap < 0) return `Early ${fmtHours(-gap / 60)}`;
  return "On time";
}

const pad2h = (n) => String(n).padStart(2, "0");

// ── Time entry helpers ────────────────────────────────────
//
// Kept here rather than in the TimeInput component so the fiddly parsing can be
// exercised on its own: the component is JSX, which plain Node cannot import.

// Keeps only digits and caps them at 4, so "9:30", "0930" and "09:30" all
// collapse to the same four digits.
export function timeDigits(text) {
  return String(text || "").replace(/\D/g, "").slice(0, 4);
}

// Turns typed digits into "HH:MM" while the user is still mid-entry.
//
// Three digits are read as one hour plus two minutes, because "930" is how
// anyone actually types half nine; only four digits can carry a two digit hour.
// Returns null when the digits are incomplete or cannot be a real clock time,
// so a bad entry is refused rather than saved, and "" when the field was
// emptied, which means clear it.
export function normalizeTime(text) {
  const d = timeDigits(text);
  if (!d) return "";
  if (d.length < 3) return null; // still typing the hour
  const h = d.length === 3 ? Number(d[0]) : Number(d.slice(0, 2));
  const m = Number(d.slice(-2));
  if (h > 23 || m > 59) return null;
  return `${pad2h(h)}:${pad2h(m)}`;
}

// Clock times to offer in the picker.
//
// Centred on the employee's own shift and padded either side, because the
// times a shopkeeper actually types are the shift start, the shift end and a
// few minutes either side of them -- not all 96 quarter hours of the day. With
// no shift set it falls back to the usual working day.
//
// A shift that ends before it starts runs past midnight, so the window is
// carried into the next day and each entry wrapped back into 00:00-23:45. That
// keeps a 22:00 to 06:00 night shift offering both of its own endpoints, which
// a plain min/max on the two times would quietly drop.
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
  // Zero padded "HH:MM" sorts into clock order as plain strings.
  return out.sort();
}