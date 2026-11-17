import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  HandCoins,
  Phone,
  ReceiptIndianRupee,
  RefreshCw,
  Search
} from "lucide-react";
import { api } from "../api";
import { useDebouncedState } from "../lib/useDebounced.js";
import Card from "../components/Card.jsx";
import Pagination from "../components/Pagination.jsx";
import StatCard from "../components/StatCard.jsx";
import { fmtDate, fmtDateTime, fmtMoney } from "../lib/format";

const PAGE_SIZE = 20;

const pad = (n) => String(n).padStart(2, "0");
const todayLocalISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthStartLocalISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "online", label: "UPI / Online" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" }
];

const METHOD_LABEL = METHODS.reduce((m, r) => ({ ...m, [r.value]: r.label }), {});

const money = (n) => fmtMoney(n);

export default function CompletedBills() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ count: 0, totalBilled: 0, totalReceived: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [sort, setSort] = useState("newest");
  const [dateFrom, setDateFrom] = useState(monthStartLocalISO);
  const [dateTo, setDateTo] = useState(todayLocalISO);
  const [page, setPage] = useState(1);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
    p.set("sort", sort);
    p.set("page", String(page));
    p.set("limit", String(PAGE_SIZE));
    return p.toString();
  }, [dateFrom, dateTo, debouncedSearch, sort, page]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.completedCustomerBills(query);
      setRows(data.rows || []);
      setTotal(Number(data.total) || 0);
      setSummary(data.summary || { count: 0, totalBilled: 0, totalReceived: 0 });
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sort, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const stats = summary;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={CheckCircle2}
          label="Completed bills"
          value={stats.count}
          sub="fully settled"
          tone="emerald"
        />
        <StatCard
          icon={ReceiptIndianRupee}
          label="Total billed"
          value={money(stats.totalBilled)}
          sub="across completed bills"
          tone="indigo"
        />
        <StatCard
          icon={HandCoins}
          label="Total received"
          value={money(stats.totalReceived)}
          sub="all payments"
          tone="violet"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-0">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Completed bills</h3>
            <p className="text-xs text-slate-400">
              Bills fully paid. All payments shown here (removed from payment register).
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 px-5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, invoice or mobile..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="From date"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="To date"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">By customer name</option>
            <option value="amount_high">Bill total (high to low)</option>
            <option value="amount_low">Bill total (low to high)</option>
          </select>
        </div>

        <div className="mt-3 space-y-2 px-5 pb-4">
          {loading ? (
            <p className="px-1 py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : total === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-400">No completed bills yet</p>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-1 py-8 text-center text-sm text-slate-400">No matching completed bills</p>
          ) : (
            pageRows.map((b) => (
              <div key={b.id} className="rounded-xl border border-slate-200/80 bg-white px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold tracking-wide text-slate-600">
                    {b.invoice_no}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                    {b.customer || "Walk-in"}
                  </p>
                  {b.customer_phone && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Phone className="h-3 w-3" /> {b.customer_phone}
                    </span>
                  )}
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Settled
                  </span>
                  <p className="text-sm font-bold text-slate-800">{money(b.total)}</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span>{fmtDate(b.created_at)}</span>
                  <span>Paid {money(b.paid)}</span>
                </div>
                {Array.isArray(b.payments) && b.payments.length > 0 && (
                  <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Payments
                    </p>
                    <div className="space-y-1">
                      {b.payments.map((pmt) => (
                        <div key={pmt.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-slate-600">{money(pmt.amount)}</span>
                          <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
                            {METHOD_LABEL[pmt.method] || pmt.method}
                          </span>
                          <span className="text-slate-400">
                            {pmt.paid_on ? fmtDate(pmt.paid_on) : fmtDateTime(pmt.created_at)}
                          </span>
                          {pmt.note && <span className="italic text-slate-400">"{pmt.note}"</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {!loading && !error && total > 0 && (
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        )}
      </Card>
    </div>
  );
}
