import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CircleDollarSign,
  PackagePlus,
  ReceiptText,
  ShoppingCart,
  TrendingUp,
  TriangleAlert,
  Users
} from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney, greeting, todayLabel } from "../lib/format.js";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { Badge, Card, Empty, PageHeader, Spinner } from "../components/ui.jsx";

function Stat({ icon: Icon, label, value, hint, tone = "brand" }) {
  const tones = {
    brand: "bg-brand-50 text-brand-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-600"
  };
  return (
    <Card className="p-3.5">
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-900">{value}</p>
      {hint ? <p className="text-[11px] text-slate-400">{hint}</p> : null}
    </Card>
  );
}

const QUICK = [
  { to: "/pos", label: "New sale", icon: ShoppingCart, tone: "bg-brand-700 text-white" },
  { to: "/products", label: "Add product", icon: PackagePlus, tone: "bg-emerald-600 text-white" },
  { to: "/customers", label: "Customers", icon: Users, tone: "bg-purple-600 text-white" },
  { to: "/expenses", label: "Expenses", icon: CircleDollarSign, tone: "bg-amber-500 text-white" },
  { to: "/reports", label: "Reports", icon: BarChart3, tone: "bg-slate-700 text-white" },
  { to: "/purchases", label: "Purchases", icon: Boxes, tone: "bg-sky-600 text-white" }
];

export default function Dashboard() {
  const { store, version } = useApp();
  const { data, loading, error } = useAsync(() => api.dashboard(), [version]);

  return (
    <div className="pb-6">
      <div className="bg-gradient-to-br from-brand-700 to-brand-900 px-4 pb-6 text-white safe-top-header">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white/70">{greeting()}</p>
            <h1 className="mt-0.5 text-xl font-bold">{store?.name || "Barkaati"}</h1>
            <p className="mt-0.5 text-[11px] text-white/60">{todayLabel()}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle onDark />
            <Link to="/settings" className="rounded-full bg-white/15 p-2.5 text-white">
              <TrendingUp className="h-5 w-5" />
            </Link>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-white/10 p-4 backdrop-blur">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
            Today's sales
          </p>
          <div className="mt-1 flex items-end justify-between">
            <p className="text-3xl font-bold">{fmtMoney(data?.today?.total)}</p>
            <p className="text-xs text-white/70">{data?.today?.bills || 0} bills</p>
          </div>
        </div>
      </div>

      <div className="px-4">
        <div className="-mt-4 grid grid-cols-2 gap-3">
          <Stat
            icon={CircleDollarSign}
            label="This month"
            value={fmtMoney(data?.month?.total)}
            hint={`Profit ${fmtMoney(data?.month?.profit)}`}
            tone="green"
          />
          <Stat
            icon={ReceiptText}
            label="Outstanding"
            value={fmtMoney(data?.outstanding)}
            hint="Customer balances"
            tone="amber"
          />
          <Stat
            icon={TriangleAlert}
            label="Low stock"
            value={String(data?.lowStock || 0)}
            hint="Items at reorder level"
            tone="red"
          />
          <Stat
            icon={Boxes}
            label="Products"
            value={String(data?.productCount || 0)}
            hint={`${data?.customerCount || 0} customers`}
            tone="brand"
          />
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Quick actions</p>
          <div className="grid grid-cols-3 gap-2.5">
            {QUICK.map(({ to, label, icon: Icon, tone }) => (
              <Link key={to} to={to} className="rounded-2xl bg-white p-3 shadow-sm active:bg-slate-50">
                <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <p className="text-xs font-semibold text-slate-700">{label}</p>
              </Link>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="text-brand-600" />
          </div>
        ) : error ? (
          <Card className="mt-4 border border-red-100 bg-red-50">
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        ) : (
          <>
            <div className="mt-5 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Recent bills</p>
              <Link to="/sales" className="flex items-center gap-1 text-xs font-semibold text-brand-700">
                See all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <Card className="mt-2 divide-y divide-slate-100 p-0">
              {data?.recent?.length ? (
                data.recent.map((sale) => (
                  <Link
                    key={sale.id}
                    to="/sales"
                    className="flex items-center justify-between gap-3 px-4 py-3 active:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {sale.customer_name || "Walk-in customer"}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {sale.invoice_no} · {fmtDate(sale.created_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{fmtMoney(sale.total)}</p>
                      <Badge tone={sale.status === "paid" ? "green" : sale.status === "partial" ? "amber" : "red"}>
                        {sale.status}
                      </Badge>
                    </div>
                  </Link>
                ))
              ) : (
                <Empty
                  icon={ReceiptText}
                  title="No bills yet"
                  description="Your first sale will show up here."
                />
              )}
            </Card>

            {data?.top?.length ? (
              <>
                <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-slate-400">
                  Top sellers this month
                </p>
                <Card className="space-y-3">
                  {data.top.map((p, i) => (
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
                  ))}
                </Card>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
