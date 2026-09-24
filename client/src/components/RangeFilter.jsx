import { CalendarRange } from "lucide-react";
import { RANGES } from "../lib/range.js";

export default function RangeFilter({ value, onChange, className = "" }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm ${className}`}
    >
      <CalendarRange className="h-4 w-4 shrink-0 text-slate-400" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent py-1 text-xs font-semibold text-slate-600 outline-none [&>option]:text-slate-700"
      >
        {RANGES.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
    </div>
  );
}