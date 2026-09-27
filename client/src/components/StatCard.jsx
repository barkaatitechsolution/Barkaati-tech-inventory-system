import { memo } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

const TONES = {
  indigo: { tile: "bg-indigo-50 text-indigo-600", glow: "bg-indigo-100" },
  emerald: { tile: "bg-emerald-50 text-emerald-600", glow: "bg-emerald-100" },
  amber: { tile: "bg-amber-50 text-amber-600", glow: "bg-amber-100" },
  rose: { tile: "bg-rose-50 text-rose-600", glow: "bg-rose-100" },
  sky: { tile: "bg-sky-50 text-sky-600", glow: "bg-sky-100" },
  violet: { tile: "bg-violet-50 text-violet-600", glow: "bg-violet-100" }
};

function StatCard({ icon: Icon, label, value, sub, tone = "indigo", delta, deltaText }) {
  const t = TONES[tone] || TONES.indigo;
  const up = delta >= 0;
  return (
    <div className="animate-fade-up rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${t.tile}`}>
          <Icon className="h-[22px] w-[22px]" />
        </div>
        {delta !== undefined && delta !== null && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-xs font-semibold ${
              up ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
            }`}
          >
            {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      <p className="mt-4 text-[13px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default memo(StatCard);