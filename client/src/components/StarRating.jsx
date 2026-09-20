import { Star } from "lucide-react";

export function StarDisplay({ value = 0, size = "h-4 w-4" }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${size} ${i <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
        />
      ))}
    </span>
  );
}

export function StarInput({ value = 0, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i === value ? 0 : i)}
          className="rounded-md p-0.5 transition hover:scale-110"
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
        >
          <Star
            className={`h-7 w-7 ${i <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
          />
        </button>
      ))}
      <span className="ml-2 text-xs font-medium text-slate-500">{value ? `${value} / 5` : "Not rated"}</span>
    </div>
  );
}