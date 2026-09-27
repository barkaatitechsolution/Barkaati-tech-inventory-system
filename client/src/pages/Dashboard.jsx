import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Package,
  Wallet,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Receipt,
  Sparkles,
  Info,
  Zap,
  Users,
  Truck,
  Wrench,
  Megaphone,
  Scale,
  Landmark,
  Coins
} from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import RangeFilter from "../components/RangeFilter.jsx";
import { fmtMoney, fmtCompact, fmtDateTime, greeting, todayLabel, initials } from "../lib/format.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { rangeFor, rangeLabel } from "../lib/range.js";

const DashboardCharts = lazy(() => import("../components/DashboardCharts.jsx"));

function ChartsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="h-80 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200/70 lg:col-span-2" />
      <div className="h-80 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200/70" />
    </div>
  );
}

const EXPENSE_STYLE = {
  Rent: { icon: Landmark, cls: "bg-indigo-50 text-indigo-600" },
  Utilities: { icon: Zap, cls: "bg-sky-50 text-sky-600" },
  Salaries: { icon: Users, cls: "bg-violet-50 text-violet-600" },
  Transport: { icon: Truck, cls: "bg-amber-50 text-amber-600" },
  Maintenance: { icon: Wrench, cls: "bg-slate-100 text-slate-600" },
  Marketing: { icon: Megaphone, cls: "bg-rose-50 text-rose-600" },
  Taxes: { icon: Scale, cls: "bg-emerald-50 text-emerald-600" }
};

function ExpenseIcon({ category }) {
  const s = EXPENSE_STYLE[category] || { icon: Receipt, cls: "bg-slate-100 text-slate-600" };
  const Icon = s.icon;
  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.cls}`}>
      <Icon className="h-[18px] w-[18px]" />
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    credit: "bg-amber-50 text-amber-700 ring-amber-200",
    partial: "bg-sky-50 text-sky-700 ring-sky-200"
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ring-1 ${map[status] || map.paid}`}
    >
      {status === "partial" ? "Part paid" : status}
    </span>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-2xl bg-white ring-1 ring-slate-200/70" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="h-80 rounded-2xl bg-white ring-1 ring-slate-200/70 lg:col-span-2" />
        <div className="h-80 rounded-2xl bg-white ring-1 ring-slate-200/70" />
      </div>
      <div className="h-80 rounded-2xl bg-white ring-1 ring-slate-200/70" />
    </div>
  );
}

export default function Dashboard({ onNavigate, onSearchTo }) {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState(null);
  const storeInfo = getStoreInfo();
  const storeName = storeInfo.name || "Barkaati Store";

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const d = await api.dashboard();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadStats = async (key) => {
    try {
      const r = rangeFor(key);
      setStats(await api.stats(r.from, r.to));
    } catch {
      /* non-critical */
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadStats(range);
  }, [range]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const kpis = data?.kpis;
  const todayDelta =
    kpis && kpis.yestSales > 0
      ? Math.round(((kpis.todaySales - kpis.yestSales) / kpis.yestSales) * 100)
      : null;

  const categoryData = useMemo(() => {
    if (!data?.categorySales?.length) return [];
    const total = data.categorySales.reduce((s, c) => s + c.value, 0);
    return data.categorySales.map((c) => ({ ...c, pct: Math.round((c.value / total) * 100) }));
  }, [data]);

  const revenueTotal = useMemo(
    () => data?.revenueSeries?.reduce((s, d) => s + d.revenue, 0) || 0,
    [data]
  );

  if (loading) return <Skeleton />;

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl bg-white py-20 shadow-sm ring-1 ring-slate-200/70">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <p className="mt-4 font-semibold text-slate-900">Couldn't load the dashboard</p>
        <p className="mt-1 text-sm text-slate-500">{error}</p>
        <button
          onClick={() => load()}
          className="mt-5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            {storeInfo.logo ? (
                <img
                  src={storeInfo.logo}
                  alt=""
                  decoding="async"
                  className="h-11 w-11 rounded-2xl border border-slate-200 bg-white object-contain p-1"
                />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-sm font-bold text-white">
                {initials(storeName)}
              </div>
            )}
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                {greeting()}, {storeName}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">{todayLabel()}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangeFilter value={range} onChange={setRange} />
          <button
            onClick={() => load(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ShoppingBag}
          label="Today's Sales"
          value={fmtMoney(kpis.todaySales)}
          tone="indigo"
          delta={todayDelta}
          sub={`Yesterday ${fmtMoney(kpis.yestSales)}`}
        />
        <StatCard
          icon={TrendingUp}
          label="This Month Revenue"
          value={fmtMoney(kpis.monthSales)}
          tone="emerald"
          sub={`Profit ${fmtMoney(kpis.monthProfit)} · Expenses ${fmtCompact(kpis.monthExpenses)}`}
        />
        <StatCard
          icon={Package}
          label="Stock Value (Cost)"
          value={fmtCompact(kpis.stockValue)}
          tone="amber"
          sub={`Retail value ${fmtCompact(kpis.retailValue)}`}
        />
        <StatCard
          icon={Wallet}
          label="Outstanding Credit"
          value={fmtCompact(kpis.outstanding)}
          tone="rose"
          sub={`${data.lowStock.length} product${data.lowStock.length === 1 ? "" : "s"} need reorder`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Coins}
          label={`Profit (${rangeLabel(range)})`}
          value={fmtMoney(stats?.kpis.profit ?? 0)}
          tone="emerald"
          sub={`Margin ${stats?.kpis.margin ?? 0}% · ${fmtCompact(stats?.kpis.orders ?? 0)} orders`}
        />
        <StatCard
          icon={ShoppingBag}
          label={`Revenue (${rangeLabel(range)})`}
          value={fmtMoney(stats?.kpis.revenue ?? 0)}
          tone="indigo"
          sub={`Collected ${fmtMoney(stats?.kpis.collected ?? 0)}`}
        />
        <StatCard
          icon={Package}
          label={`Cost of goods (${rangeLabel(range)})`}
          value={fmtMoney(stats?.kpis.cost ?? 0)}
          tone="amber"
        />
        <StatCard
          icon={AlertTriangle}
          label={`Expenses (${rangeLabel(range)})`}
          value={fmtMoney(stats?.kpis.expenses ?? 0)}
          tone="rose"
        />
      </div>

      <Suspense fallback={<ChartsSkeleton />}>
        <DashboardCharts stats={stats} range={range} categoryData={categoryData} revenueTotal={revenueTotal} />
      </Suspense>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900">Recent Sales</h3>
              <p className="text-xs text-slate-500">Latest transactions</p>
            </div>
            <button
              onClick={() => onNavigate("sales")}
              className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="pb-2.5 pr-3">Customer</th>
                  <th className="pb-2.5 pr-3">Invoice</th>
                  <th className="hidden pb-2.5 pr-3 sm:table-cell">Date</th>
                  <th className="pb-2.5 pr-3 text-right">Amount</th>
                  <th className="pb-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSales.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-slate-800">{s.customer}</p>
                      <p className="text-[11px] text-slate-400 capitalize">{s.payment_method}</p>
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs text-slate-500">{s.invoice_no}</td>
                    <td className="hidden py-3 pr-3 text-xs text-slate-500 sm:table-cell">
                      {fmtDateTime(s.created_at)}
                    </td>
                    <td className="py-3 pr-3 text-right font-bold text-slate-800">{fmtMoney(s.total)}</td>
                    <td className="py-3 text-right">
                      <StatusPill status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 font-bold text-slate-900">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Low Stock Alerts
              </h3>
              <p className="text-xs text-slate-500">Reorder before you run out</p>
            </div>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-600">
              {data.lowStock.length}
            </span>
          </div>
          <div className="mt-4 space-y-4">
            {data.lowStock.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
                <Sparkles className="h-5 w-5" /> All products are well stocked.
              </div>
            ) : (
              data.lowStock.slice(0, 6).map((p) => {
                const ratio = Math.min(p.reorder_level > 0 ? p.stock / p.reorder_level : 1, 1);
                const critical = ratio <= 0.5;
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                        <p className="shrink-0 text-xs text-slate-400">
                          {Math.round(p.stock)} / {Math.round(p.reorder_level)} {p.unit}
                        </p>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">{p.category}</p>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${critical ? "bg-rose-500" : "bg-amber-400"}`}
                          style={{ width: `${Math.max(ratio * 100, 6)}%` }}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => onSearchTo(p.name)}
                      className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                    >
                      Reorder
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="lg:col-span-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900">Top Selling Products</h3>
              <p className="text-xs text-slate-500">By quantity sold this month</p>
            </div>
            <button
              onClick={() => onNavigate("products")}
              className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Inventory <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {data.topProducts.map((p, i) => {
              const max = data.topProducts[0]?.qty || 1;
              return (
                <div key={p.name} className="flex items-center gap-3">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      i === 0
                        ? "bg-amber-100 text-amber-700"
                        : i === 1
                          ? "bg-slate-200 text-slate-600"
                          : i === 2
                            ? "bg-orange-100 text-orange-700"
                            : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                      <p className="shrink-0 text-xs font-semibold text-slate-500">
                        {p.qty} sold · {fmtMoney(p.revenue)}
                      </p>
                    </div>
                    <p className="text-[11px] text-slate-400">{p.category}</p>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                        style={{ width: `${(p.qty / max) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="lg:col-span-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900">Recent Expenses</h3>
              <p className="text-xs text-slate-500">Cash going out</p>
            </div>
            <button
              onClick={() => onNavigate("expenses")}
              className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Expenses <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {data.recentExpenses.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-xl bg-slate-50/70 p-3 ring-1 ring-slate-100"
              >
                <ExpenseIcon category={e.category} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{e.description}</p>
                  <p className="text-[11px] text-slate-400">
                    {e.category} · {fmtDateTime(e.date)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold text-rose-600">−{fmtMoney(e.amount)}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl ring-1 ring-white/10">
            <Info className="h-4 w-4 text-indigo-400" />
            {toast}
            <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
          </div>
        </div>
      )}
    </div>
  );
}
