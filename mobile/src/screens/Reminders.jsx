import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, ChevronRight, Phone, Wallet } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import { shareToWhatsApp } from "../lib/share.js";
import { Badge, Button, Card, Empty, PageHeader, Spinner, cx, showToast } from "../components/ui.jsx";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "soon", label: "Soon" },
  { key: "money", label: "Money" },
  { key: "work", label: "Work" }
];

const KIND_META = {
  customer_due: { label: "Customer due", tone: "purple", icon: Wallet },
  supplier_due: { label: "Supplier due", tone: "amber", icon: Wallet },
  cheque: { label: "Cheque", tone: "blue", icon: CalendarClock },
  task: { label: "Task", tone: "slate", icon: CheckCircle2 },
  call: { label: "Call back", tone: "green", icon: Phone }
};

const SEVERITY_TONE = {
  overdue: "red",
  today: "amber",
  soon: "blue",
  week: "slate",
  later: "slate",
  unscheduled: "slate"
};

const severityLabel = (r) => {
  if (r.days_left === null) return "No date";
  if (r.days_left < 0) return `${Math.abs(r.days_left)}d overdue`;
  if (r.days_left === 0) return "Today";
  if (r.days_left === 1) return "Tomorrow";
  return `In ${r.days_left}d`;
};

export default function Reminders() {
  const { version } = useApp();
  const { data, loading, error } = useAsync(() => api.reminders(), [version]);
  const [filter, setFilter] = useState("all");

  const list = data?.reminders || [];
  const summary = data?.summary || { total: 0, overdue: 0, due_today: 0, needs_attention: 0 };

  const filtered = useMemo(() => {
    if (filter === "all") return list;
    if (filter === "money") return list.filter((r) => ["customer_due", "supplier_due", "cheque"].includes(r.kind));
    if (filter === "work") return list.filter((r) => ["task", "call"].includes(r.kind));
    return list.filter((r) => r.severity === filter);
  }, [list, filter]);

  const sendReminder = async (r) => {
    const text = `Hello ${r.title}, a gentle reminder about your pending balance of ${fmtMoney(r.amount)} with us. Please clear it at your convenience. Thank you!`;
    try {
      await shareToWhatsApp(r.meta?.phone, text);
    } catch {
      showToast("Could not open WhatsApp", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Reminders"
        subtitle={`${summary.needs_attention} need attention · ${summary.total} total`}
      />

      <div className="space-y-3 px-4">
        <div className="grid grid-cols-3 gap-2">
          <Card className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Overdue</p>
            <p className="mt-0.5 text-lg font-bold text-red-600">{summary.overdue}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Today</p>
            <p className="mt-0.5 text-lg font-bold text-amber-600">{summary.due_today}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{summary.total}</p>
          </Card>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cx(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                filter === f.key ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => {
              const meta = KIND_META[r.kind] || KIND_META.task;
              const Icon = meta.icon;
              return (
                <Card key={r.key} className="p-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={cx(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                        r.severity === "overdue" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800">{r.title}</p>
                        {r.amount != null ? <p className="shrink-0 text-sm font-bold text-slate-900">{fmtMoney(r.amount)}</p> : null}
                      </div>
                      <p className="truncate text-[11px] text-slate-400">{r.subtitle}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={SEVERITY_TONE[r.severity]}>{severityLabel(r)}</Badge>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {r.due_date ? <span className="text-[10px] text-slate-400">{fmtDate(r.due_date)}</span> : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1">
                    {r.kind === "customer_due" && r.meta?.phone ? (
                      <Button size="sm" variant="ghost" onClick={() => sendReminder(r)}>
                        <Phone className="h-3.5 w-3.5" /> Remind
                      </Button>
                    ) : null}
                    <Link
                      to={`/${r.page}`}
                      className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-brand-700 active:bg-brand-50"
                    >
                      Open <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={BellRing}
            title="Nothing needs attention"
            description="Customer dues, supplier payments, cheques, tasks and call backs will show up here."
          />
        )}

        {summary.overdue > 0 ? (
          <div className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs">{summary.overdue} item{summary.overdue === 1 ? "" : "s"} are past their due date.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
