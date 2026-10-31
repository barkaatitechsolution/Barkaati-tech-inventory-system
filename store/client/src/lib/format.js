export const fmtMoney = (value) =>
  `₹${(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// A bare "YYYY-MM-DD" is a calendar date; parsing it through `new Date` would
// read it as UTC midnight and shift the day in timezones behind UTC.
const parseDate = (iso) => {
  if (iso === null || iso === undefined || iso === "") return null;
  const s = String(iso).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return isNaN(d) ? null : d;
};

const pad2 = (n) => String(n).padStart(2, "0");

export const fmtDate = (iso) => {
  const d = parseDate(iso);
  if (!d) return iso;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const fmtDateTime = (iso) => {
  const d = parseDate(iso);
  if (!d) return iso;
  return `${fmtDate(iso)}, ${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  })}`;
};
