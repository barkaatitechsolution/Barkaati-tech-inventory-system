import { CalendarRange } from "lucide-react";
import { RANGES } from "../lib/range.js";

export default function RangeFilter({ value, onChange, className = "" }) {
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm ${className}`}
    >
      <CalendarRange className="ml-1.5 hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />

      <div className="hidden items-center gap-1 sm:flex">
        {RANGES.map((r) => {
          const active = r.key === value;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => onChange(r.key)}
              aria-pressed={active}
              className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 px-2 py-1 sm:hidden">
        <CalendarRange className="h-4 w-4 shrink-0 text-slate-400" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none bg-transparent text-xs font-semibold text-slate-600 outline-none [&>option]:text-slate-700"
        >
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
