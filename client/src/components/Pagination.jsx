import { memo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

function buildPageList(current, total) {
  if (total <= 0) return [];
  const pages = [];
  const push = (n) => {
    if (pages[pages.length - 1] !== n) pages.push(n);
  };
  const lo = Math.max(1, current - 2);
  const hi = Math.min(total, current + 2);
  push(1);
  if (lo > 2) push("…");
  for (let i = lo; i <= hi; i++) push(i);
  if (hi < total - 1) push("…");
  push(total);
  return pages;
}

function Pagination({ page, pageSize, total, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const go = (p) => {
    const next = Math.max(1, Math.min(p, totalPages));
    if (next !== page) onChange(next);
  };

  const btn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-1 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 sm:px-6">
      <p className="text-xs text-slate-500">
        Showing <span className="font-semibold text-slate-700">{Math.min((page - 1) * pageSize + 1, total)}</span>
        {" – "}
        <span className="font-semibold text-slate-700">{Math.min(page * pageSize, total)}</span> of{" "}
        <span className="font-semibold text-slate-700">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button className={btn} onClick={() => go(1)} disabled={page <= 1} aria-label="First page">
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button className={btn} onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {buildPageList(page, totalPages).map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="px-1 text-sm text-slate-400">
              …
            </span>
          ) : (
            <button
              key={n}
              onClick={() => go(n)}
              className={`${btn} ${n === page ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {n}
            </button>
          )
        )}
        <button className={btn} onClick={() => go(page + 1)} disabled={page >= totalPages} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button className={btn} onClick={() => go(totalPages)} disabled={page >= totalPages} aria-label="Last page">
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default memo(Pagination);