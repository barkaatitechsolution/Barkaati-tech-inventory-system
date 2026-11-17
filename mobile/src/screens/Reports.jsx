import { useState } from "react";
import { BarChart3, CircleDollarSign, ReceiptText, TrendingUp, TriangleAlert } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import { Badge, Card, Empty, Field, Input, PageHeader, Spinner } from "../components/ui.jsx";

function Stat({ label, value, hint, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    green: "text-emerald-700",
    red: "text-red-600",
    amber: "text-amber-600",
    brand: "text-brand-700"
  };
  return (
    <Card className="p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${tones[tone]}`}>{value}</p>
      {hint ? <p className="text-[11px] text-slate-400">{hint}</p> : null}
    </Card>
  );
}

export default function Reports() {
  const { version } = useApp();
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [from, setFrom] = useState(iso(first));
  const [to, setTo] = useState(iso(today));

  const stats = useAsync(() => api.stats(from, to), [from, to, version]);
  const dashboard = useAsync(() => api.dashboard(), [version]);
  const products = useAsync(() => api.products({ limit: 500 }), [version]);

  const lowStock = (products.data || []).filter(
    (p) => Number(p.reorder_level) > 0 && Number(p.stock) <= Number(p.reorder_level)
  );
  const net = (stats.data?.sales || 0) - (stats.data?.expenses || 0) - (stats.data?.returns || 0);

  return (
    <div className="pb-24">
      <PageHeader title="Reports" subtitle="Sales, profit and stock health" />
      <div className="px-4">
        <Card className="grid grid-cols-2 gap-2">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </Card>
      </div>

      {stats.loading ? (
        <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
      ) : stats.error ? (
        <div className="px-4 pt-3">
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{stats.error}</p></Card>
        </div>
      ) : (
        <div className="mt-3 space-y-3 px-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Sales" value={fmtMoney(stats.data?.sales)} hint={`${stats.data?.bills || 0} bills`} tone="brand" />
            <Stat label="Profit" value={fmtMoney(stats.data?.profit)} hint="From line margins" tone="green" />
            <Stat label="Expenses" value={fmtMoney(stats.data?.expenses)} hint="In this period" tone="red" />
            <Stat label="Returns" value={fmtMoney(stats.data?.returns)} hint="Refunded value" tone="amber" />
          </div>
          <Card className="flex items-center justify-between bg-slate-900 text-white">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">Net</p>
              <p className="text-xl font-bold">{fmtMoney(net)}</p>
              <p className="text-[11px] text-white/50">Sales − expenses − returns</p>
            </div>
            <TrendingUp className="h-8 w-8 text-white/40" />
          </Card>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Top sellers this month</p>
            <Card className="space-y-3">
              {dashboard.data?.top?.length ? (
                dashboard.data.top.map((p, i) => (
                  <div key={`${p.product_name}-${i}`} className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{p.product_name}</p>
                      <p className="text-[11px] text-slate-400">{Number(p.qty) || 0} sold</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-700">{fmtMoney(p.total)}</p>
                  </div>
                ))
              ) : (
                <Empty icon={BarChart3} title="No sales this month" />
              )}
            </Card>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Low stock</p>
              <Badge tone={lowStock.length ? "amber" : "green"}>{lowStock.length} items</Badge>
            </div>
            <Card className="space-y-2">
              {lowStock.length ? (
                lowStock.slice(0, 15).map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                      <p className="text-[11px] text-slate-400">Reorder at {p.reorder_level}</p>
                    </div>
                    <Badge tone={Number(p.stock) <= 0 ? "red" : "amber"}>
                      {Number(p.stock)} {p.unit || "pcs"}
                    </Badge>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 py-2 text-sm text-emerald-700">
                  <TriangleAlert className="h-4 w-4" /> All stock levels look healthy.
                </div>
              )}
            </Card>
          </div>

          <Card className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <ReceiptText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Outstanding balance</p>
              <p className="text-[11px] text-slate-400">Across all unpaid bills</p>
            </div>
            <p className="ml-auto text-base font-bold text-slate-900">{fmtMoney(dashboard.data?.outstanding)}</p>
          </Card>

          <p className="pb-2 text-center text-[11px] text-slate-400">
            {fmtDate(from)} to {fmtDate(to)}
          </p>
        </div>
      )}
    </div>
  );
}
