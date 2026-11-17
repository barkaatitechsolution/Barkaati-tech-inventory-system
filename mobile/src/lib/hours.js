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
