import { Calendar } from "lucide-react";

export function Field({ label, hint, required, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const base =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50";

// Date and datetime pickers carry a calendar icon on their left edge, the same
// way search inputs carry a magnifying glass, so every page shows the same
// affordance whatever field it is.
const DATE_TYPES = new Set(["date", "datetime-local"]);

export function Input({ className = "", type, ...props }) {
  if (DATE_TYPES.has(type)) {
    return (
      <div className="relative">
        <input type={type} className={`${base} pl-9 ${className}`} {...props} />
        <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    );
  }
  return <input type={type} className={`${base} ${className}`} {...props} />;
}

export function Textarea({ className = "", rows = 3, ...props }) {
  return <textarea rows={rows} className={`${base} ${className}`} {...props} />;
}

export function Button({ variant = "primary", className = "", children, ...props }) {
  const variants = {
    primary: "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-700",
    ghost: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    soft: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}