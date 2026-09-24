const pad = (n) => String(n).padStart(2, "0");

function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" }
];

export function rangeFor(key) {
  const today = new Date();
  const isoToday = iso(today);
  switch (key) {
    case "today":
      return { key, from: isoToday, to: isoToday };
    case "week": {
      const d = new Date(today);
      d.setDate(d.getDate() - ((today.getDay() + 6) % 7));
      return { key, from: iso(d), to: isoToday };
    }
    case "year":
      return { key, from: iso(new Date(today.getFullYear(), 0, 1)), to: isoToday };
    case "all":
      return { key, from: "2000-01-01", to: isoToday };
    case "month":
    default: {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return { key, from: iso(d), to: isoToday };
    }
  }
}

export function rangeLabel(key) {
  return (RANGES.find((r) => r.key === key) || RANGES[2]).label;
}