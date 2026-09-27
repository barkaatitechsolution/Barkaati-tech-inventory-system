import { useEffect, useMemo, useState } from "react";
import { BarChart3, TrendingUp, TrendingDown, Receipt, Coins } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import RangeFilter from "../components/RangeFilter.jsx";
import { fmtMoney } from "../lib/format.js";
import { rangeFor, rangeLabel } from "../lib/range.js";

const EMPTY_SERIES = [];

export default function Reports() {
  const [stats, setStats] = useState(null);
  const [dash, setDash] = useState(null);
  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .dashboard()
      .then(setDash)
      .catch(() => setDash(null));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = rangeFor(range);
        const [s] = await Promise.all([api.stats(r.from, r.to)]);
        setStats(s);
        setError(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [range]);

  const series = stats?.series ?? EMPTY_SERIES;

  const chartData = useMemo(() => series.slice(-14), [series]);
  const maxVal = useMemo(
    () => Math.max(...series.map((r) => Math.max(r.revenue, r.profit, r.expenses)), 1),
    [series]
  );
  const hasChartData = useMemo(
    () => series.some((r) => r.revenue || r.profit || r.expenses),
    [series]
  );

  if (loading || !stats) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-50" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-rose-600">Failed to load reports: {error}</p>;
  }

  const { kpis, categorySales, topProducts } = stats;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Reports</h2>
          <p className="text-sm text-slate-500">{rangeLabel(range)} performance</p>
        </div>
        <RangeFilter value={range} onChange={setRange} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-slate-400">Revenue</p>
              <p className="text-lg font-bold text-slate-800">{fmtMoney(kpis.revenue)}</p>
            </div>
          </div>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-slate-400">Profit</p>
              <p className={`text-lg font-bold ${kpis.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {fmtMoney(kpis.profit)}
              </p>
              <p className="text-[11px] text-slate-400">Margin {kpis.margin}%</p>
            </div>
          </div>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <TrendingDown className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-slate-400">Cost of goods</p>
              <p className="text-lg font-bold text-slate-800">{fmtMoney(kpis.cost)}</p>
            </div>
          </div>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-slate-400">Expenses</p>
              <p className="text-lg font-bold text-slate-800">{fmtMoney(kpis.expenses)}</p>
              <p className="text-[11px] text-slate-400">{kpis.orders} orders</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Revenue Trend Chart */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold text-slate-700">
          Revenue, Profit & Expenses ({rangeLabel(range)})
        </h3>
        {!hasChartData ? (
          <p className="py-12 text-center text-sm text-slate-400">
            No sales or expense data for this period
          </p>
        ) : (
          <>
            <div className="flex h-48 items-end gap-1">
              {chartData.map((d, i) => {
                const revH = (d.revenue / maxVal) * 100;
                const profH = (d.profit / maxVal) * 100;
                const expH = (d.expenses / maxVal) * 100;
                return (
                  <div
                    key={i}
                    className="flex flex-1 items-end justify-center gap-0.5"
                    title={`${d.day}: Rev ${fmtMoney(d.revenue)}, Profit ${fmtMoney(d.profit)}, Exp ${fmtMoney(d.expenses)}`}
                  >
                    <div className="w-1/3 rounded-t bg-indigo-400" style={{ height: `${revH}%` }} />
                    <div className="w-1/3 rounded-t bg-emerald-400" style={{ height: `${profH}%` }} />
                    <div className="w-1/3 rounded-t bg-rose-300" style={{ height: `${expH}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-slate-400">
              <span>{chartData[0]?.day}</span>
              <span>{chartData[chartData.length - 1]?.day}</span>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-indigo-400" /> Revenue</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-emerald-400" /> Profit</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-rose-300" /> Expenses</span>
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category Sales */}
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Sales by Category</h3>
          {categorySales.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No sales data</p>
          ) : (
            <div className="space-y-3">
              {categorySales.map((c, i) => {
                const maxVal = Math.max(...categorySales.map((x) => x.value), 1);
                const pct = (c.value / maxVal) * 100;
                return (
                  <div key={i}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium text-slate-700">{c.category}</span>
                      <span className="text-slate-500">{fmtMoney(c.value)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-indigo-400" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Top Products */}
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Top Products</h3>
          {topProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No sales data</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase text-slate-400">
                    <th className="pb-2">Product</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2">
                        <p className="font-medium text-slate-800">{p.name}</p>
                        <p className="text-[11px] text-slate-400">{p.category}</p>
                      </td>
                      <td className="py-2 text-right text-slate-600">{p.qty}</td>
                      <td className="py-2 text-right font-semibold text-slate-800">{fmtMoney(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Recent Sales</h3>
          {!dash || dash.recentSales.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No sales yet</p>
          ) : (
            <div className="space-y-2">
              {dash.recentSales.slice(0, 6).map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-50 bg-slate-50/50 px-3 py-2">
                  <div>
                    <p className="text-xs font-medium text-slate-700">{s.invoice_no}</p>
                    <p className="text-[11px] text-slate-400">{s.customer}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-800">{fmtMoney(s.total)}</p>
                    <p className="text-[11px] capitalize text-slate-400">{s.payment_method}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Recent Expenses</h3>
          {!dash || dash.recentExpenses.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No expenses yet</p>
          ) : (
            <div className="space-y-2">
              {dash.recentExpenses.slice(0, 6).map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-lg border border-slate-50 bg-slate-50/50 px-3 py-2">
                  <div>
                    <p className="text-xs font-medium text-slate-700">{e.category}</p>
                    <p className="text-[11px] text-slate-400">{e.description || "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-rose-600">{fmtMoney(e.amount)}</p>
                    <p className="text-[11px] capitalize text-slate-400">{e.payment_method}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}