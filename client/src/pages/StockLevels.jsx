import { useState, useEffect, useMemo } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import {
  Search,
  Layers,
  Package,
  PackageOpen,
  Boxes,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  RefreshCw
} from "lucide-react";
import { api } from "../api";
import { fmtMoney, fmtCompact } from "../lib/format";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import Pagination from "../components/Pagination.jsx";

const PAGE_SIZE = 25;
const FETCH_STEP = 500;

// Stock is fractional (a half-used pack), so trim the trailing zeros rather
// than showing "87.5000".
const fmtQty = (value) => {
  const n = Number(value) || 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
};

const stockStatus = (row) => {
  const stock = Number(row.stock) || 0;
  const reorder = Number(row.reorder_level) || 0;
  if (stock <= 0) return { label: "Out of stock", pill: "bg-rose-100 text-rose-700" };
  if (reorder > 0 && stock <= reorder) return { label: "Low", pill: "bg-amber-100 text-amber-700" };
  return { label: "In stock", pill: "bg-emerald-100 text-emerald-700" };
};

const SORTS = {
  name: { label: "Product", get: (r) => String(r.name || "").toLowerCase() },
  stock: { label: "Stock remaining", get: (r) => Number(r.stock) || 0 },
  packs: { label: "Open packs", get: (r) => Number(r.open_packs) || 0 },
  value: { label: "Stock value", get: (r) => Number(r.stock_value) || 0 }
};

export default function StockLevels() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [sortKey, setSortKey] = useState("name");
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      // Pull the whole catalogue so totals, search and sorting stay exact
      // regardless of how many pages the server hands back at a time.
      const all = [];
      for (let offset = 0; ; offset += FETCH_STEP) {
        const res = await api.products({ limit: FETCH_STEP, offset });
        const batch = res.rows || [];
        all.push(...batch);
        const total = Number(res.total) || 0;
        if (!batch.length || all.length >= total) break;
      }
      setRows(all);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    const out = term
      ? rows.filter(
          (r) =>
            String(r.name || "").toLowerCase().includes(term) ||
            String(r.category || "").toLowerCase().includes(term) ||
            String(r.unit || "").toLowerCase().includes(term)
        )
      : rows.slice();

    const get = SORTS[sortKey].get;
    out.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === "string") return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      return asc ? av - bv : bv - av;
    });
    return out;
  }, [rows, debouncedSearch, sortKey, asc]);

  const totals = useMemo(() => {
    let units = 0;
    let value = 0;
    let low = 0;
    let out = 0;
    for (const r of rows) {
      units += Number(r.stock) || 0;
      value += Number(r.stock_value) || 0;
      const s = stockStatus(r).label;
      if (s === "Out of stock") out += 1;
      else if (s === "Low") low += 1;
    }
    return { units, value, low, out };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const toggleSort = (key) => {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(key === "name");
    }
  };

  const SortHead = ({ sort, className = "" }) => {
    const active = sortKey === sort;
    const Icon = active ? (asc ? ArrowUp : ArrowDown) : null;
    return (
      <th className={`px-3 py-3 sm:px-5 ${className}`}>
        <button
          onClick={() => toggleSort(sort)}
          className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-600 ${
            active ? "text-indigo-600" : ""
          }`}
        >
          {SORTS[sort].label}
          {Icon ? <Icon className="h-3 w-3" /> : null}
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Package} label="Products" value={rows.length.toLocaleString("en-US")} sub="in the catalogue" tone="indigo" />
        <StatCard icon={PackageOpen} label="Stock on hand" value={fmtQty(totals.units)} sub="units across all packs" tone="sky" />
        <StatCard icon={Boxes} label="Stock value" value={fmtCompact(totals.value)} sub={`at purchase cost · ${fmtMoney(totals.value)}`} tone="violet" />
        <StatCard
          icon={AlertTriangle}
          label="Needs restock"
          value={totals.low + totals.out}
          sub={`${totals.out} out of stock · ${totals.low} running low`}
          tone={totals.low + totals.out > 0 ? "rose" : "emerald"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <p className="text-xs text-slate-400">
          {loading ? "Loading…" : `${filtered.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} products`}
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <Card className="!p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : error ? (
          <p className="p-5 text-sm text-rose-600">Failed to load stock: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Layers className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">
              {rows.length === 0 ? "No products yet" : "No matching products"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {rows.length === 0
                ? "Add products and record purchases to see stock here."
                : "Try a different search term."}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold text-slate-400">
                    <SortHead sort="name" />
                    <SortHead sort="packs" className="hidden sm:table-cell" />
                    <SortHead sort="stock" className="text-right" />
                    <SortHead sort="value" className="hidden text-right sm:table-cell" />
                    <th className="px-3 py-3 sm:px-5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const status = stockStatus(r);
                    return (
                      <tr key={r.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                        <td className="px-3 py-3 sm:px-5">
                          <p className="font-semibold text-slate-800">{r.name}</p>
                          <p className="text-xs text-slate-400">
                            {r.category || "Uncategorised"}
                            {r.unit ? ` · ${r.unit}` : ""}
                          </p>
                        </td>
                        <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">
                          {fmtQty(r.open_packs)}
                        </td>
                        <td className="px-3 py-3 text-right sm:px-5">
                          <span className="font-bold tabular-nums text-slate-900">{fmtQty(r.stock)}</span>
                        </td>
                        <td className="hidden px-3 py-3 text-right text-slate-600 sm:table-cell">
                          {fmtMoney(r.stock_value)}
                        </td>
                        <td className="px-3 py-3 sm:px-5">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${status.pill}`}>
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 sm:hidden">
              {pageRows.map((r) => {
                const status = stockStatus(r);
                return (
                  <div key={r.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-800">{r.name}</p>
                        <p className="text-xs text-slate-400">
                          {r.category || "Uncategorised"}
                          {r.unit ? ` · ${r.unit}` : ""}
                        </p>
                      </div>
                      <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${status.pill}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-slate-400">
                        {fmtQty(r.open_packs)} {r.open_packs === 1 ? "pack" : "packs"}
                      </span>
                      <span className="font-bold tabular-nums text-slate-900">{fmtQty(r.stock)} left</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length > 0 && (
              <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
            )}
          </>
        )}
      </Card>
    </div>
  );
}