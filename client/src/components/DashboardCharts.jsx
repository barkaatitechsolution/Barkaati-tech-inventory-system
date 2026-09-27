import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from "recharts";
import Card from "./Card.jsx";
import { fmtMoney, fmtCompact } from "../lib/format.js";
import { rangeLabel } from "../lib/range.js";

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#0ea5e9", "#f43f5e", "#8b5cf6", "#14b8a6", "#f97316"];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-slate-900 px-3 py-2.5 text-xs shadow-xl ring-1 ring-white/10">
      <p className="mb-1.5 font-semibold text-white">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-300 capitalize">{p.dataKey}</span>
          <span className="ml-auto pl-4 font-semibold text-white">{fmtMoney(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardCharts({ stats, range, categoryData, revenueTotal }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-slate-900">Revenue, Profit & Expenses</h3>
            <p className="text-xs text-slate-500">{rangeLabel(range)} · daily values</p>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /> Sales
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Profit
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" /> Expenses
            </span>
            <span className="hidden font-semibold text-slate-700 sm:inline">
              {fmtCompact(stats?.kpis?.revenue ?? 0)}
            </span>
          </div>
        </div>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats?.series ?? []} margin={{ top: 5, right: 5, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fb7185" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2.5} fill="url(#gSales)" />
              <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2.5} fill="url(#gProfit)" />
              <Area type="monotone" dataKey="expenses" stroke="#fb7185" strokeWidth={2.5} fill="url(#gExp)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="flex flex-col">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-slate-900">Sales by Category</h3>
            <p className="text-xs text-slate-500">This month</p>
          </div>
        </div>
        <div className="relative mx-auto mt-2 h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={categoryData}
                dataKey="value"
                nameKey="category"
                innerRadius="62%"
                outerRadius="90%"
                paddingAngle={3}
                strokeWidth={2}
              >
                {categoryData.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, name) => [fmtMoney(v), name]}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                  boxShadow: "0 10px 25px -5px rgb(0 0 0 / 0.1)"
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-xl font-bold text-slate-900">{fmtCompact(revenueTotal)}</p>
            <p className="text-[11px] text-slate-400">30-day sales</p>
          </div>
        </div>
        <div className="mt-2 space-y-2">
          {categoryData.slice(0, 5).map((c, i) => (
            <div key={c.category} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="flex-1 truncate font-medium text-slate-600">{c.category}</span>
              <span className="text-slate-400">{c.pct}%</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
