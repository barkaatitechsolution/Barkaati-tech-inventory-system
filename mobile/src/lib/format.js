export const fmtMoney = (value) =>
  `Rs ${Math.round(Number(value) || 0).toLocaleString("en-US")}`;

export const fmtCompact = (value) =>
  `Rs ${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value) || 0)}`;

const parseDate = (iso) => {
  if (iso === null || iso === undefined || iso === "") return null;
  if (iso instanceof Date) return isNaN(iso) ? null : iso;
  const s = String(iso).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const normalized = /^\d{4}-\d{2}-\d{2}\s/.test(s) ? s.replace(" ", "T") : s;
  const d = new Date(normalized);
  return isNaN(d) ? null : d;
};

const pad2 = (n) => String(n).padStart(2, "0");

export const fmtDate = (iso) => {
  const d = parseDate(iso);
  if (!d) return iso || "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const toDateInput = (iso) => {
  const d = parseDate(iso);
  if (!d) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export const fmtDateTime = (iso) => {
  const d = parseDate(iso);
  if (!d) return iso || "";
  return `${fmtDate(iso)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

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

export const todayLabel = () =>
  `${fmtDate(new Date())}, ${new Date().toLocaleDateString("en-US", { weekday: "long" })}`;

export const todayISO = () => toDateInput(new Date());
