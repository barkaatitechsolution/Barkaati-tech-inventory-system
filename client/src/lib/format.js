export const fmtMoney = (value) =>
  `Rs ${Math.round(Number(value) || 0).toLocaleString("en-US")}`;

export const fmtCompact = (value) =>
  `Rs ${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value) || 0)}`;

// Postgres DATE columns arrive as a bare "YYYY-MM-DD". `new Date("2026-01-15")`
// treats that as UTC midnight, so reading the local fields back gives the
// *previous* day in any timezone behind UTC and an employee joining on the
// 15th appears to have joined on the 14th. Parse a bare date as a calendar
// date in local time instead.
//
// The anchors matter: matching only the date prefix would also swallow a real
// timestamp like "2026-03-05T15:30:00Z" and drop its time, printing every sale
// as 12:00 AM. Only the exact bare-date shape gets the local treatment;
// anything carrying a time keeps its offset and normal parsing.
const parseDate = (iso) => {
  if (iso === null || iso === undefined || iso === "") return null;
  const s = String(iso).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return isNaN(d) ? null : d;
};

const pad2 = (n) => String(n).padStart(2, "0");

// Display format is dd/mm/yyyy -- 05/03/2026 is 5 March, matching the shop's
// own paperwork. Assembled by hand rather than via toLocaleDateString so the
// order never follows the browser or OS locale, which is how a date can end up
// mm/dd on one machine and dd/mm on another.
//
// Note the month always comes second, so a bare "2026-03" month key cannot be
// fed in here by mistake -- that would render as a bogus 01/01. Use fmtMonth.
export const fmtDate = (iso) => {
  const d = parseDate(iso);
  if (!d) return iso;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Round-trips back to the ISO "YYYY-MM-DD" that <input type="date"> needs.
// Deliberately unchanged: that is the value format for the wire and the
// database, not something to display.
export const toDateInput = (iso) => {
  const d = parseDate(iso);
  if (!d) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// Date and time together, e.g. "05/03/2026, 3:24 PM".
export const fmtDateTime = (iso) => {
  const d = parseDate(iso);
  if (!d) return iso;
  return `${fmtDate(iso)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

// A month with no day, e.g. "March 2026". Spelled out because a period picker
// reads better as a name than as "03/2026".
export const fmtMonth = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || "").trim());
  if (!m) return key || "";
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
};

export const initials = (name) =>
  (name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

export const todayLabel = () => `${fmtDate(new Date())}, ${new Date().toLocaleDateString("en-US", { weekday: "long" })}`;