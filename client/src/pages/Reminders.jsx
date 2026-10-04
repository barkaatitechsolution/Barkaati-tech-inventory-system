import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  Search,
  Truck,
  Users
} from "lucide-react";
import { api } from "../api.js";
import { useDebouncedState } from "../lib/useDebounced.js";
import { fmtMoney, fmtDate } from "../lib/format.js";
import Card from "../components/Card.jsx";
import { Input } from "../components/Field.jsx";

// The shop opens this page with one question — "what is due?" — so the windows
// are ordered by how soon they close, from already late through to far off.
const BUCKETS = [
  { key: "overdue", label: "Overdue", match: (r) => r.days_left !== null && r.days_left < 0 },
  { key: "today", label: "Today", match: (r) => r.days_left === 0 },
  { key: "tomorrow", label: "Tomorrow", match: (r) => r.days_left === 1 },
  { key: "d2", label: "In 2 days", match: (r) => r.days_left === 2 },
  { key: "d3", label: "In 3 days", match: (r) => r.days_left === 3 },
  { key: "week", label: "This week", match: (r) => r.days_left !== null && r.days_left > 3 && r.days_left <= 7 },
  { key: "later", label: "Later", match: (r) => r.days_left !== null && r.days_left > 7 },
  { key: "undated", label: "No date", match: (r) => r.days_left === null }
];

const KINDS = [
  {
    key: "all",
    label: "Everything",
    icon: Bell,
    chip: "bg-slate-100 text-slate-700",
    accent: "text-slate-500 bg-slate-100"
  },
  {
    key: "customer_due",
    label: "Pending bills",
    icon: Users,
    chip: "bg-amber-50 text-amber-700",
    accent: "text-amber-600 bg-amber-50"
  },
  {
    key: "supplier_due",
    label: "Pay suppliers",
    icon: Truck,
    chip: "bg-violet-50 text-violet-700",
    accent: "text-violet-600 bg-violet-50"
  },
  {
    key: "cheque",
    label: "Cheques",
    icon: Banknote,
    chip: "bg-sky-50 text-sky-700",
    accent: "text-sky-600 bg-sky-50"
  },
  {
    key: "task",
    label: "Tasks",
    icon: ClipboardList,
    chip: "bg-emerald-50 text-emerald-700",
    accent: "text-emerald-600 bg-emerald-50"
  }
];

const kindOf = (key) => KINDS.find((k) => k.key === key) || KINDS[0];

// The left rail is the fastest read on the page: colour says how late it is
// without anyone having to parse a date.
const SEVERITY = {
  overdue: { rail: "bg-rose-500", pill: "bg-rose-50 text-rose-700", text: "text-rose-600" },
  today: { rail: "bg-amber-500", pill: "bg-amber-50 text-amber-700", text: "text-amber-600" },
  soon: { rail: "bg-indigo-400", pill: "bg-indigo-50 text-indigo-700", text: "text-indigo-600" },
  week: { rail: "bg-sky-400", pill: "bg-sky-50 text-sky-700", text: "text-sky-600" },
  later: { rail: "bg-slate-300", pill: "bg-slate-100 text-slate-600", text: "text-slate-500" },
  unscheduled: { rail: "bg-slate-200", pill: "bg-slate-100 text-slate-500", text: "text-slate-400" }
};

const PAGE_TITLE = {
  customers: "Customers",
  purchases: "Supplier Purchases",
  cheques: "Cheques",
  tasks: "Tasks"
};

const daysLabel = (r) => {
  if (r.days_left === null) {
    const n = r.meta?.outstanding_days;
    return n ? `Outstanding ${n} day${n === 1 ? "" : "s"}` : "No date set";
  }
  if (r.days_left < 0) {
    const n = Math.abs(r.days_left);
    return `${n} day${n === 1 ? "" : "s"} overdue`;
  }
  if (r.days_left === 0) return "Due today";
  if (r.days_left === 1) return "Due tomorrow";
  return `${r.days_left} days left`;
};

const detailOf = (r) => {
  if (r.kind === "customer_due") {
    const bits = [];
    if (r.meta?.phone) bits.push(r.meta.phone);
    if (r.meta?.email) bits.push(r.meta.email);
    return bits.join(" · ") || "No phone or email on file";
  }
  if (r.kind === "supplier_due") {
    return r.due_date ? `Payment due ${fmtDate(r.due_date)}` : "No payment date set";
  }
  if (r.kind === "cheque") {
    const bits = [];
    if (r.meta?.bank_name) bits.push(r.meta.bank_name);
    if (r.due_date) bits.push(`Clears ${fmtDate(r.due_date)}`);
    return bits.join(" · ") || "No clearing date set";
  }
  return r.due_date ? `Due ${fmtDate(r.due_date)}` : "No due date set";
};

export default function Reminders({ onNavigate }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ total: 0, overdue: 0, due_today: 0, needs_attention: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [bucket, setBucket] = useState("all");
  const [kind, setKind] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.reminders();
      setRows(data?.reminders || []);
      setSummary(
        data?.summary || { total: 0, overdue: 0, due_today: 0, needs_attention: 0 }
      );
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Bucket counts are taken before the search and kind filters are applied on
  // purpose: a chip that says "3" while the list below it shows none is worse
  // than no count at all, so the chips always describe the full picture.
  const counts = useMemo(() => {
    const map = { all: rows.length };
    BUCKETS.forEach((b) => {
      map[b.key] = rows.filter(b.match).length;
    });
    return map;
  }, [rows]);

  const kindCounts = useMemo(() => {
    const map = { all: rows.length };
    rows.forEach((r) => {
      map[r.kind] = (map[r.kind] || 0) + 1;
    });
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const active = BUCKETS.find((b) => b.key === bucket);
    return rows.filter((r) => {
      const matchesBucket = !active || active.match(r);
      const matchesKind = kind === "all" || r.kind === kind;
      const matchesQuery =
        !q ||
        [r.title, r.subtitle, r.due_date, r.meta?.cheque_no, r.meta?.bank_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      return matchesBucket && matchesKind && matchesQuery;
    });
  }, [rows, debouncedSearch, bucket, kind]);

  const totalAmount = useMemo(
    () => filtered.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    [filtered]
  );

  // The undated bucket is worth a nudge of its own: those balances are real
  // money, but with no date on them they can never surface through a window.
  const undatedTotal = useMemo(
    () => rows.filter((r) => r.kind === "customer_due").reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    [rows]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-lg shadow-rose-500/25">
              <Bell className="h-5 w-5" />
            </span>
            Reminders
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Everything still open with a clock on it, newest deadline first
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Today at a glance — each tile is also a filter shortcut. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          tone="rose"
          label="Overdue"
          value={summary.overdue}
          hint={summary.overdue ? "Past their date" : "Nothing late"}
          onClick={() => setBucket("overdue")}
        />
        <StatTile
          tone="amber"
          label="Due today"
          value={summary.due_today}
          hint={summary.due_today ? "Clear these today" : "Nothing today"}
          onClick={() => setBucket("today")}
        />
        <StatTile
          tone="indigo"
          label="Next 7 days"
          value={rows.filter((r) => r.days_left !== null && r.days_left >= 0 && r.days_left <= 7).length}
          hint="Coming up"
          onClick={() => setBucket("week")}
        />
        <StatTile
          tone="slate"
          label="Undated balances"
          value={counts.undated || 0}
          hint={undatedTotal ? `${fmtMoney(undatedTotal)} owed, no date` : "All dated"}
          onClick={() => setBucket("undated")}
        />
      </div>

      {/* Filters */}
      <Card className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, cheque number or bank"
              className="pl-9"
            />
          </div>
          <p className="shrink-0 text-xs text-slate-500">
            Showing <span className="font-semibold text-slate-700">{filtered.length}</span> of{" "}
            {rows.length}
            {totalAmount > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-slate-700">{fmtMoney(totalAmount)}</span> involved
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Chip active={bucket === "all"} onClick={() => setBucket("all")} count={counts.all}>
            All
          </Chip>
          {BUCKETS.map((b) => (
            <Chip
              key={b.key}
              active={bucket === b.key}
              onClick={() => setBucket(b.key)}
              count={counts[b.key]}
              tone={SEVERITY[b.key === "undated" ? "unscheduled" : b.key]?.text}
            >
              {b.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {KINDS.map((k) => {
            const Icon = k.icon;
            const active = kind === k.key;
            return (
              <button
                key={k.key}
                onClick={() => setKind(k.key)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  active
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {k.label}
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${active ? "bg-white/70" : "bg-slate-100"}`}>
                  {kindCounts[k.key] || 0}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/70 ring-1 ring-slate-200/70" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <p className="text-base font-semibold text-slate-900">Nothing in this window</p>
          <p className="max-w-sm text-sm text-slate-500">
            {rows.length === 0
              ? "No unpaid bills, no pending cheques, no open tasks and no supplier dues. Nothing needs chasing."
              : "No reminders match this filter. Try a wider window or clear the search."}
          </p>
          {rows.length > 0 && (
            <button
              onClick={() => {
                setBucket("all");
                setKind("all");
                setSearch("");
              }}
              className="mt-1 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Clear filters
            </button>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const meta = kindOf(r.kind);
            const Icon = meta.icon;
            const sev = SEVERITY[r.severity] || SEVERITY.later;
            return (
              <Card key={r.key} className="p-0 overflow-hidden">
                <div className="flex items-stretch">
                  <span className={`w-1.5 shrink-0 ${sev.rail}`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.accent}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">{r.title}</p>
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${sev.pill}`}>
                            {daysLabel(r)}
                          </span>
                          {r.kind === "task" && r.meta?.priority === "urgent" && (
                            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                              Urgent
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{r.subtitle}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-400">{detailOf(r)}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      {r.amount !== null && (
                        <p className={`text-base font-bold ${sev.text}`}>{fmtMoney(r.amount)}</p>
                      )}
                      {onNavigate && (
                        <button
                          onClick={() => onNavigate(r.page)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-indigo-600"
                        >
                          {PAGE_TITLE[r.page] || "Open"}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatTile({ tone, label, value, hint, onClick }) {
  const tones = {
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    slate: "bg-slate-50 text-slate-700 ring-slate-200/70"
  };
  const icons = {
    rose: AlertTriangle,
    amber: CalendarClock,
    indigo: Bell,
    slate: Users
  };
  const Icon = icons[tone];
  return (
    <button
      onClick={onClick}
      className={`group rounded-2xl p-4 text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-md ${tones[tone]}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">{label}</p>
        <Icon className="h-4 w-4 opacity-40" />
      </div>
      <p className="mt-1.5 text-2xl font-bold">{Number(value) || 0}</p>
      <p className="mt-0.5 text-[11px] opacity-70">{hint}</p>
    </button>
  );
}

function Chip({ active, onClick, count, tone, children }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
      <span
        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
          active ? "bg-white/20 text-white" : tone ? `${tone} bg-white` : "bg-slate-100 text-slate-500"
        }`}
      >
        {count || 0}
      </span>
    </button>
  );
}