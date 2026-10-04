import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  UserCog,
  CalendarDays,
  Wallet,
  Plus,
  Search,
  Pencil,
  Trash2,
  Clock,
  Phone,
  UserPlus,
  Check,
  Star,
  FolderOpen,
  Upload,
  FileText,
  Trash,
  TrendingUp,
  PiggyBank,
  AlertTriangle,
  Eye
} from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import TimeInput from "../components/TimeInput.jsx";
import { fmtMoney, fmtDate, fmtMonth, toDateInput, initials } from "../lib/format.js";
import { workedHours, fmtHours, arrivalLabel, timeOptions } from "../lib/hours.js";
import { patchAttRow } from "../lib/attendance.js";

// ── Local helpers ─────────────────────────────────────────────
const localDate = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const currentMonth = () => localDate().slice(0, 7);

const monthBounds = (m) => {
  const [y, mo] = String(m || "").split("-").map(Number);
  if (!y || !mo) return { first: "", last: "", days: 0 };
  const p = (n) => String(n).padStart(2, "0");
  return { first: `${y}-${p(mo)}-01`, last: `${y}-${p(mo)}-${p(new Date(y, mo, 0).getDate())}`, days: new Date(y, mo, 0).getDate() };
};

const stripTime = (t) => (t ? String(t).slice(0, 5) : "");

// ── Options ───────────────────────────────────────────────────
const PAY_MODES = [
  { value: "salary", label: "Salary (fixed per month)", amountLabel: "Monthly salary", amountHint: "A day is worth (amount × 12) ÷ 364.5, and a month never earns more than this." },
  { value: "wages", label: "Daily wages (per day worked)", amountLabel: "Wage per day", amountHint: "Paid for every day actually worked. No monthly limit." },
  { value: "freelancer", label: "Freelancer (no attendance pay)", amountLabel: "Agreed amount", amountHint: "Attendance does not change the balance. Only payments recorded against him do." }
];

const RANKS = ["noob", "pro", "prince", "king"];

const STATUS_OPTIONS = [
  { value: "present", label: "Present", credit: "+1 day", color: "bg-emerald-50 text-emerald-700" },
  { value: "half_day", label: "Half day", credit: "+½ day", color: "bg-amber-50 text-amber-700" },
  { value: "holiday", label: "Holiday", credit: "+1 day", color: "bg-violet-50 text-violet-700" },
  { value: "leave", label: "Leave", credit: "no pay", color: "bg-slate-100 text-slate-600" },
  { value: "absent", label: "Absent", credit: "no pay", color: "bg-rose-50 text-rose-700" }
];

const STATUS_META = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s]));

const PAYMENT_OPTIONS = [
  { value: "salary", label: "Salary paid" },
  { value: "advance", label: "Advance taken" },
  { value: "bonus", label: "Bonus" },
  { value: "deduction", label: "Deduction" }
];

const blankEmployee = () => ({
  name: "",
  phone: "",
  email: "",
  address: "",
  designation: "",
  salary_type: "salary",
  salary_rate: "",
  rank: "noob",
  stars: 1,
  shift_start: "",
  shift_end: "",
  joining_date: "",
  starting_date: "",
  pf_enabled: false,
  pf_rate: 12,
  notes: ""
});

const blankPayment = () => ({ type: "salary", amount: "", payment_method: "cash", date: localDate(), note: "" });

// ── Small presentational pieces ───────────────────────────────
function Stars({ n = 0, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} title={`${n} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${i <= n ? "fill-amber-400 text-amber-400" : "text-slate-200"}`}
        />
      ))}
    </span>
  );
}

const RankBadge = ({ rank }) => {
  const tone = {
    noob: "bg-slate-100 text-slate-600",
    pro: "bg-sky-50 text-sky-700",
    prince: "bg-violet-50 text-violet-700",
    king: "bg-amber-50 text-amber-700"
  }[rank] || "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
      {rank}
    </span>
  );
};

// Green when the shop still owes him, red when he has been paid ahead.
function BalancePill({ label, value }) {
  const owed = Number(value) > 0;
  return (
    <div className={`rounded-xl px-3 py-2 ${owed ? "bg-emerald-50" : "bg-rose-50"}`}>
      <p className={`text-[10px] font-semibold ${owed ? "text-emerald-600" : "text-rose-500"}`}>{label}</p>
      <p className={`text-base font-bold ${owed ? "text-emerald-700" : "text-rose-600"}`}>{fmtMoney(value)}</p>
    </div>
  );
}

function MoneyRow({ label, value, strong = false, tone = "" }) {
  return (
    <div className={`flex items-center justify-between text-xs ${strong ? "font-bold" : ""}`}>
      <span className="text-slate-400">{label}</span>
      <span className={tone || "font-semibold text-slate-700"}>{fmtMoney(value)}</span>
    </div>
  );
}

export default function Employee() {
  const [tab, setTab] = useState("staff"); // staff | attendance | payroll
  const [month, setMonth] = useState(currentMonth);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [empForm, setEmpForm] = useState(blankEmployee);
  const [savingEmp, setSavingEmp] = useState(false);

  const [attDate, setAttDate] = useState(localDate);
  const [attRows, setAttRows] = useState({});
  const [savingAtt, setSavingAtt] = useState(false);

  const [payEmpId, setPayEmpId] = useState("");
  const [ledger, setLedger] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [payForm, setPayForm] = useState(blankPayment);
  const [payOpen, setPayOpen] = useState(false);
  const [savingPay, setSavingPay] = useState(false);

  const [docsFor, setDocsFor] = useState(null);
  const [docLabel, setDocLabel] = useState("");
  const [uploading, setUploading] = useState(false);

  const [confirm, setConfirm] = useState(null);

  // Toasts fire constantly here (every save, mark and upload). Each one used to
  // start its own 2.5s timer, so a burst stacked timers that kept the closure
  // alive and an earlier one wiped a newer message early. One timer, replaced
  // on every call, released on unmount.
  const toastTimer = useRef(null);
  const say = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      setToast("");
    }, 2500);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // ── Data ───────────────────────────────────────────────────
  const reload = useCallback(
    async (m = month) => {
      try {
        const list = await api.employees(m);
        setEmployees(Array.isArray(list) ? list : []);
        setError("");
      } catch (e) {
        setError(e.message || "Could not load employees");
      } finally {
        setLoading(false);
      }
    },
    [month]
  );

  useEffect(() => {
    setLoading(true);
    reload(month);
  }, [reload, month]);

  // Attendance for the single date being marked, for every employee at once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await api.attendance(attDate, attDate);
        if (!alive) return;
        const next = {};
        (rows || []).forEach((r) => {
          next[String(r.employee_id)] = {
            status: r.status || "present",
            time_in: stripTime(r.time_in),
            time_out: stripTime(r.time_out),
            notes: r.notes || ""
          };
        });
        setAttRows(next);
      } catch {
        /* a failed attendance read should not blank the page */
      }
    })();
    return () => {
      alive = false;
    };
  }, [attDate]);

  // Ledger for the payroll tab.
  useEffect(() => {
    if (tab !== "payroll" || !payEmpId) {
      setLedger(null);
      return;
    }
    let alive = true;
    setLedgerLoading(true);
    (async () => {
      try {
        const led = await api.employeeLedger(payEmpId, month);
        if (alive) setLedger(led);
      } catch (e) {
        if (alive) setError(e.message || "Could not load the ledger");
      } finally {
        if (alive) setLedgerLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, payEmpId, month]);

  useEffect(() => {
    if (tab === "payroll" && !payEmpId && employees.length) setPayEmpId(String(employees[0].id));
  }, [tab, payEmpId, employees]);

  // ── Derived ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      [e.name, e.designation, e.phone, e.rank].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [employees, search]);

  const payEmp = employees.find((e) => String(e.id) === String(payEmpId)) || null;

  const setEmp = (key, value) => setEmpForm((f) => ({ ...f, [key]: value }));

  // ── Employee create / edit ─────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setEmpForm(blankEmployee());
    setFormOpen(true);
  };

  const openEdit = (e) => {
    setEditing(e);
    setEmpForm({
      name: e.name || "",
      phone: e.phone || "",
      email: e.email || "",
      address: e.address || "",
      designation: e.designation || "",
      salary_type: e.salary_type || "salary",
      salary_rate: e.salary_rate ?? "",
      rank: e.rank || "noob",
      stars: Number(e.stars) || 1,
      shift_start: stripTime(e.shift_start),
      shift_end: stripTime(e.shift_end),
      joining_date: toDateInput(e.joining_date) || "",
      starting_date: toDateInput(e.starting_date) || "",
      pf_enabled: !!e.pf_enabled,
      pf_rate: e.pf_rate ?? 12,
      notes: e.notes || ""
    });
    setFormOpen(true);
  };

  const saveEmployee = async () => {
    if (!empForm.name.trim()) return setError("Name is required");
    setSavingEmp(true);
    try {
      if (editing) {
        await api.updateEmployee(editing.id, empForm);
        say("Employee updated");
      } else {
        await api.createEmployee(empForm);
        say("Employee added");
      }
      setFormOpen(false);
      await reload();
    } catch (e) {
      setError(e.message || "Could not save the employee");
    } finally {
      setSavingEmp(false);
    }
  };

  const removeEmployee = async () => {
    try {
      await api.deleteEmployee(confirm.id);
      setConfirm(null);
      say("Employee removed");
      if (String(payEmpId) === String(confirm.id)) setPayEmpId("");
      await reload();
    } catch (e) {
      setError(e.message || "Could not remove the employee");
    }
  };

  // ── Attendance marking ─────────────────────────────────────
  const setAtt = (empId, field, value) =>
    setAttRows((prev) => ({
      ...prev,
      [String(empId)]: patchAttRow(prev[String(empId)], field, value)
    }));

  // Totals for the day being marked. Hours only count where both clock times
  // are filled in, so a half-entered row nudges the total by nothing rather
  // than by a wrong number.
  const attTotals = useMemo(() => {
    let hours = 0;
    let clocked = 0;
    let present = 0;
    for (const e of employees) {
      const r = attRows[String(e.id)];
      if (!r) continue;
      if (r.status === "present" || r.status === "holiday") present++;
      const h = workedHours(r.time_in, r.time_out);
      if (h !== null) {
        hours += h;
        clocked++;
      }
    }
    return { hours, clocked, present };
  }, [employees, attRows]);

  const markAllPresent = () => {
    const next = { ...attRows };
    employees.forEach((e) => {
      const k = String(e.id);
      // Status is forced last so "Mark all present" always wins over whatever
      // was picked before, while clock times already typed are kept.
      next[k] = patchAttRow(next[k], "status", "present");
    });
    setAttRows(next);
  };

  const saveAttendance = async () => {
    setSavingAtt(true);
    try {
      for (const e of employees) {
        const r = attRows[String(e.id)];
        if (!r) continue;
        await api.saveAttendance({
          employee_id: e.id,
          date: attDate,
          status: r.status,
          time_in: r.time_in || null,
          time_out: r.time_out || null,
          notes: r.notes || null
        });
      }
      say("Attendance saved");
      await reload();
    } catch (e) {
      setError(e.message || "Could not save attendance");
    } finally {
      setSavingAtt(false);
    }
  };

  // ── Payments ───────────────────────────────────────────────
  const savePayment = async () => {
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) return setError("Enter an amount greater than zero");
    setSavingPay(true);
    try {
      await api.createEmployeePayment(payEmpId, { ...payForm, amount });
      setPayOpen(false);
      setPayForm(blankPayment());
      say("Payment recorded");
      await reload();
    } catch (e) {
      setError(e.message || "Could not record the payment");
    } finally {
      setSavingPay(false);
    }
  };

  const removePayment = async (id) => {
    try {
      await api.deletePayment(id);
      say("Payment removed");
      await reload();
    } catch (e) {
      setError(e.message || "Could not remove the payment");
    }
  };

  // ── Documents ──────────────────────────────────────────────
  const openDocs = async (emp) => {
    setDocsFor(emp);
    setDocLabel("");
    try {
      const full = await api.employee(emp.id, month);
      setDocsFor((d) => (d ? { ...d, documents: full.documents || [] } : d));
    } catch (e) {
      setError(e.message || "Could not open documents");
    }
  };

  const uploadDocs = async (fileList) => {
    const files = [...fileList].filter(Boolean);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) await api.uploadEmployeeDoc(docsFor.id, file, docLabel);
      setDocLabel("");
      say(files.length === 1 ? "Document uploaded" : `${files.length} documents uploaded`);
      const full = await api.employee(docsFor.id, month);
      setDocsFor((d) => (d ? { ...d, documents: full.documents || [] } : d));
      await reload();
    } catch (e) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeDoc = async (id) => {
    try {
      await api.deleteEmployeeDoc(id);
      say("Document removed");
      setDocsFor((d) => (d ? { ...d, documents: (d.documents || []).filter((x) => x.id !== id) } : d));
      await reload();
    } catch (e) {
      setError(e.message || "Could not remove the document");
    }
  };

  // ── Render pieces ──────────────────────────────────────────
  const tabs = [
    { key: "staff", label: "Staff", icon: UserCog },
    { key: "attendance", label: "Attendance", icon: CalendarDays },
    { key: "payroll", label: "Pay & Ledger", icon: Wallet }
  ];

  const amountField = PAY_MODES.find((m) => m.value === empForm.salary_type) || PAY_MODES[0];

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <UserCog className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Employees</p>
            <p className="text-xs text-slate-500">
              {employees.length} staff · pay accrues from the attendance you mark
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
          {tab === "staff" && (
            <Button onClick={openCreate} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Add Employee
            </Button>
          )}
          {tab === "payroll" && payEmp && (
            <Button onClick={() => setPayOpen(true)} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Record Payment
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 scrollbar-thin">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap transition ${
                active ? "border-indigo-500 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError("")} className="shrink-0 font-bold">
            Dismiss
          </button>
        </div>
      )}
      {toast && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {toast}
        </div>
      )}

      {/* ── STAFF ──────────────────────────────────────────── */}
      {tab === "staff" && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, role or rank…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {loading ? (
            <Card className="p-8 text-center text-sm text-slate-400">Loading…</Card>
          ) : filtered.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm font-semibold text-slate-600">No employees yet</p>
              <p className="mt-1 text-xs text-slate-400">
                Add your first employee to start tracking attendance and pay.
              </p>
              <Button className="mt-4" onClick={openCreate}>
                <UserPlus className="h-4 w-4" /> Add Employee
              </Button>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((e) => {
                const p = e.payroll || {};
                const lf = p.lifetime || {};
                const isFreelancer = e.salary_type === "freelancer";
                return (
                  <Card key={e.id} className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600">
                          {initials(e.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-800">{e.name}</p>
                          <p className="truncate text-xs text-slate-400">
                            {e.designation || "Employee"}
                            {e.phone && <span> · {e.phone}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => openDocs(e)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                          aria-label="Documents"
                          title="Documents"
                        >
                          <FolderOpen className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => openEdit(e)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() =>
                            setConfirm({
                              id: e.id,
                              name: e.name,
                              message: `Delete ${e.name}? Their attendance, payments and documents go with them.`
                            })
                          }
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <RankBadge rank={e.rank} />
                      <Stars n={Number(e.stars) || 0} />
                      {e.shift_start && e.shift_end && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                          <Clock className="h-3 w-3" /> {stripTime(e.shift_start)}–{stripTime(e.shift_end)}
                        </span>
                      )}
                      {!!e.pf_enabled && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700">
                          <PiggyBank className="h-3 w-3" /> PF {Number(e.pf_rate) || 0}%
                        </span>
                      )}
                      {!!e.documents && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                          <FileText className="h-3 w-3" /> {e.documents}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {isFreelancer ? (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                          Freelancer · {fmtMoney(e.salary_rate)}
                        </span>
                      ) : e.salary_type === "wages" ? (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                          {fmtMoney(e.salary_rate)}/day
                        </span>
                      ) : (
                        <>
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                            {fmtMoney(e.salary_rate)}/month
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                            <TrendingUp className="h-3 w-3" /> {fmtMoney(p.daily)}/day
                          </span>
                        </>
                      )}
                    </div>

                    <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">
                          {isFreelancer ? "Payments only" : `Earned in ${fmtMonth(month)}`}
                        </span>
                        <span className="font-semibold text-slate-700">
                          {isFreelancer ? fmtMoney(p.paid?.total) : `${fmtMoney(p.accrual)} · ${p.paidDays || 0}d`}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <BalancePill label={fmtMonth(month)} value={p.balance} />
                        <BalancePill label="All time" value={lf.balance} />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ATTENDANCE ─────────────────────────────────────── */}
      {tab === "attendance" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Date" hint="Marking attendance adds to that day's pay.">
              <Input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} className="w-44" />
            </Field>
            <Button variant="soft" onClick={markAllPresent}>
              <Check className="h-4 w-4" /> Mark all present
            </Button>
            <Button onClick={saveAttendance} disabled={savingAtt}>
              {savingAtt ? "Saving…" : "Save attendance"}
            </Button>
            <span className="ml-auto text-xs text-slate-500">
              {attTotals.present} of {employees.length} marked
              {attTotals.clocked > 0 && (
                <span className="ml-2 font-semibold tabular-nums text-slate-700">
                  {fmtHours(attTotals.hours)} worked
                </span>
              )}
            </span>
          </div>

          {employees.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-400">Add employees first to mark attendance.</Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {employees.map((e) => {
                const r = attRows[String(e.id)] || { status: "present", time_in: "", time_out: "" };
                const daily = Number(e.payroll?.daily) || 0;
                const meta = STATUS_META[r.status];
                const earns =
                  r.status === "present" || r.status === "holiday"
                    ? daily
                    : r.status === "half_day"
                      ? daily / 2
                      : 0;
                // Clock times are shown for the record only -- the status above
                // is what decides the pay, so an odd time never moves money.
                const hours = workedHours(r.time_in, r.time_out);
                const arrival = arrivalLabel(r.time_in, e.shift_start);
                const arrivedLate = arrival && arrival.startsWith("Late");
                return (
                  <Card key={e.id} className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800">{e.name}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {e.designation || "Employee"}
                          {daily > 0 && <span> · {fmtMoney(daily)}/day</span>}
                        </p>
                      </div>
                      <select
                        value={r.status}
                        onChange={(ev) => setAtt(e.id, "status", ev.target.value)}
                        className="shrink-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium outline-none transition focus:border-indigo-400"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <TimeInput
                        value={r.time_in}
                        onChange={(v) => setAtt(e.id, "time_in", v)}
                        options={timeOptions(e.shift_start, e.shift_end)}
                        ariaLabel={`Time in for ${e.name}`}
                      />
                      <TimeInput
                        value={r.time_out}
                        onChange={(v) => setAtt(e.id, "time_out", v)}
                        options={timeOptions(e.shift_start, e.shift_end)}
                        ariaLabel={`Time out for ${e.name}`}
                      />
                    </div>

                    {(hours !== null || arrival) && (
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Worked</span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-semibold tabular-nums text-slate-700">{fmtHours(hours)}</span>
                          {arrival && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 font-medium ${
                                arrivedLate
                                  ? "bg-amber-50 text-amber-700"
                                  : arrival === "On time"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {arrival}
                            </span>
                          )}
                        </span>
                      </div>
                    )}

                    <div
                      className={`flex items-center justify-between rounded-xl px-3 py-1.5 text-[11px] font-semibold ${
                        meta?.color || "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <span>{meta?.credit}</span>
                      <span>{earns > 0 ? `+${fmtMoney(earns)}` : "₹0"}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── PAYROLL ────────────────────────────────────────── */}
      {tab === "payroll" && (
        <div className="space-y-5">
          {employees.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-400">
              Add an employee to see pay and payments.
            </Card>
          ) : (
            <>
              <Field label="Employee" className="max-w-sm">
                <select
                  value={payEmpId}
                  onChange={(e) => setPayEmpId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>

              {payEmp && (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Card className="space-y-2">
                      <p className="text-sm font-bold text-slate-800">{fmtMonth(month)}</p>
                      <MoneyRow label="Earned from attendance" value={payEmp.payroll.accrual} />
                      <MoneyRow
                        label="Provident fund (employee)"
                        value={payEmp.payroll.pf.employee}
                        tone="text-violet-600"
                      />
                      <MoneyRow label="Net payable" value={payEmp.payroll.netPayable} strong />
                      <MoneyRow label="Paid" value={payEmp.payroll.paid.total} tone="text-amber-600" />
                      <div className="pt-1">
                        <BalancePill
                          label={payEmp.payroll.balance >= 0 ? "Still owed" : "Paid ahead of earning"}
                          value={Math.abs(payEmp.payroll.balance)}
                        />
                      </div>
                      {payEmp.payroll.capped && (
                        <p className="flex items-start gap-1 text-[11px] text-slate-400">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          Reached the full monthly amount on {fmtDate(payEmp.payroll.cappedOn)}.
                        </p>
                      )}
                    </Card>

                    <Card className="space-y-2">
                      <p className="text-sm font-bold text-slate-800">All time</p>
                      <MoneyRow label="Total earned" value={payEmp.payroll.lifetime.accrual} />
                      <MoneyRow
                        label="Provident fund (employee)"
                        value={payEmp.payroll.lifetime.pf.employee}
                        tone="text-violet-600"
                      />
                      <MoneyRow label="Total paid" value={payEmp.payroll.lifetime.paid.total} tone="text-amber-600" />
                      <div className="pt-1">
                        <BalancePill
                          label={payEmp.payroll.lifetime.balance >= 0 ? "Still owed" : "Paid ahead of earning"}
                          value={Math.abs(payEmp.payroll.lifetime.balance)}
                        />
                      </div>
                      {payEmp.pf_enabled && (
                        <p className="text-[11px] text-slate-400">
                          Employer share of PF so far: {fmtMoney(payEmp.payroll.lifetime.pf.employer)} (a cost to the
                          shop, not deducted from him).
                        </p>
                      )}
                    </Card>
                  </div>

                  {/* Ledger */}
                  <Card className="space-y-3 p-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
                      <p className="text-sm font-bold text-slate-800">How this month adds up</p>
                      <p className="text-xs text-slate-400">Every marked day and payment, in order.</p>
                    </div>

                    {ledgerLoading ? (
                      <p className="px-5 py-8 text-center text-sm text-slate-400">Loading…</p>
                    ) : !ledger || !ledger.events.length ? (
                      <p className="px-5 py-8 text-center text-sm text-slate-400">
                        Nothing marked for {fmtMonth(month)} yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              <th className="px-5 py-2">Date</th>
                              <th className="px-5 py-2">Detail</th>
                              <th className="px-5 py-2 text-right">Amount</th>
                              <th className="px-5 py-2 text-right">Running</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ledger.events.map((ev, i) => {
                              const evHours =
                                ev.kind === "attendance" ? workedHours(ev.time_in, ev.time_out) : null;
                              return (
                              <tr key={i} className="border-b border-slate-50 last:border-0">
                                <td className="px-5 py-2 text-xs text-slate-500">
                                  {ev.date ? fmtDate(ev.date) : "—"}
                                </td>
                                <td className="px-5 py-2">
                                  {ev.kind === "attendance" ? (
                                    <span className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                          STATUS_META[ev.status]?.color || "bg-slate-100 text-slate-600"
                                        }`}
                                      >
                                        {STATUS_META[ev.status]?.label || ev.status}
                                      </span>
                                      {evHours !== null && (
                                        <span className="text-[11px] tabular-nums text-slate-400">
                                          {fmtHours(evHours)}
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-600">{ev.label}</span>
                                  )}
                                </td>
                                <td
                                  className={`px-5 py-2 text-right font-semibold ${
                                    ev.amount >= 0 ? "text-emerald-600" : "text-rose-600"
                                  }`}
                                >
                                  {ev.amount >= 0 ? "+" : ""}
                                  {fmtMoney(ev.amount)}
                                </td>
                                <td className="px-5 py-2 text-right font-bold text-slate-700">{fmtMoney(ev.running)}</td>
                              </tr>
                              );
                            })}
                            <tr>
                              <td colSpan={3} className="px-5 py-3 text-right text-sm font-bold text-slate-800">
                                Balance for {fmtMonth(month)}
                              </td>
                              <td
                                className={`px-5 py-3 text-right text-base font-bold ${
                                  ledger.balance >= 0 ? "text-emerald-600" : "text-rose-600"
                                }`}
                              >
                                {fmtMoney(ledger.balance)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Employee form ──────────────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        wide
        title={editing ? `Edit ${editing.name}` : "Add employee"}
        subtitle="Pay is worked out from attendance — the amount below sets the rate."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEmployee} disabled={savingEmp}>
              {savingEmp ? "Saving…" : editing ? "Save changes" : "Add employee"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input value={empForm.name} onChange={(e) => setEmp("name", e.target.value)} />
            </Field>
            <Field label="Designation">
              <Input value={empForm.designation} onChange={(e) => setEmp("designation", e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={empForm.phone} onChange={(e) => setEmp("phone", e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={empForm.email} onChange={(e) => setEmp("email", e.target.value)} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How is he paid?">
              <select
                value={empForm.salary_type}
                onChange={(e) => setEmp("salary_type", e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                {PAY_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={amountField.amountLabel} hint={amountField.amountHint}>
              <Input
                type="number"
                min="0"
                step="1"
                value={empForm.salary_rate}
                onChange={(e) => setEmp("salary_rate", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rank">
              <select
                value={empForm.rank}
                onChange={(e) => setEmp("rank", e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                {RANKS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Stars (${empForm.stars} of 5)`}>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setEmp("stars", i)}
                    aria-label={`${i} star${i > 1 ? "s" : ""}`}
                    className="rounded-lg p-0.5 transition hover:bg-amber-50"
                  >
                    <Star
                      className={`h-5 w-5 ${
                        i <= Number(empForm.stars) ? "fill-amber-400 text-amber-400" : "text-slate-200"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shift starts" hint="Working hours are kept for reference only — they do not change pay.">
              <TimeInput
                value={empForm.shift_start}
                onChange={(v) => setEmp("shift_start", v)}
                options={timeOptions("", "")}
                ariaLabel="Shift start time"
              />
            </Field>
            <Field label="Shift ends">
              <TimeInput
                value={empForm.shift_end}
                onChange={(v) => setEmp("shift_end", v)}
                options={timeOptions(empForm.shift_start, "")}
                ariaLabel="Shift end time"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Joining date" hint="The day he joined the shop.">
              <Input
                type="date"
                value={empForm.joining_date}
                onChange={(e) => setEmp("joining_date", e.target.value)}
              />
            </Field>
            <Field
              label="Payroll starts"
              hint="Pay begins accruing from this date. Attendance before it earns nothing."
            >
              <Input
                type="date"
                value={empForm.starting_date}
                onChange={(e) => setEmp("starting_date", e.target.value)}
              />
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={!!empForm.pf_enabled}
                onChange={(e) => setEmp("pf_enabled", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="text-sm font-semibold text-slate-700">Provident fund</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  His share comes out of his pay and the shop matches it. Both are a percentage of what he earns.
                </span>
              </span>
            </label>
            {empForm.pf_enabled && (
              <Field label="PF rate (%)" className="mt-3 max-w-[10rem]">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={empForm.pf_rate}
                  onChange={(e) => setEmp("pf_rate", e.target.value)}
                />
              </Field>
            )}
          </div>

          <Field label="Address">
            <Textarea rows={2} value={empForm.address} onChange={(e) => setEmp("address", e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={empForm.notes} onChange={(e) => setEmp("notes", e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* ── Documents ───────────────────────────────────────── */}
      <Modal
        open={!!docsFor}
        onClose={() => setDocsFor(null)}
        wide
        title={docsFor ? `Documents · ${docsFor.name}` : "Documents"}
        subtitle="Images and PDF files, up to 10MB each."
        footer={
          <Button variant="ghost" onClick={() => setDocsFor(null)}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Label for the next file" hint="Optional — helps you recognise it later.">
              <Input
                value={docLabel}
                onChange={(e) => setDocLabel(e.target.value)}
                placeholder="e.g. Aadhar, bank passbook"
              />
            </Field>
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 self-end rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-700">
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading…" : "Choose files"}
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  uploadDocs(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {!docsFor?.documents?.length ? (
            <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              No documents yet.
            </p>
          ) : (
            <div className="space-y-2">
              {docsFor.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
                >
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">
                      {doc.label || "Document"}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {doc.file_type} · {Math.max(1, Math.round((doc.file_size || 0) / 1024))}KB ·{" "}
                      {fmtDate(doc.uploaded_at)}
                    </p>
                  </div>
                  <a
                    href={doc.file_path}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                    aria-label="Open"
                    title="Open"
                  >
                    <Eye className="h-4 w-4" />
                  </a>
                  <button
                    onClick={() => removeDoc(doc.id)}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Delete"
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* ── Record payment ──────────────────────────────────── */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title={payEmp ? `Pay ${payEmp.name}` : "Record payment"}
        subtitle={
          payEmp
            ? `${fmtMonth(month)} balance ${fmtMoney(payEmp.payroll.balance)} — any payment comes off this.`
            : ""
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePayment} disabled={savingPay}>
              {savingPay ? "Saving…" : "Record payment"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What is this?">
              <select
                value={payForm.type}
                onChange={(e) => setPayForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                {PAYMENT_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" required>
              <Input
                type="number"
                min="0"
                step="1"
                value={payForm.amount}
                onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={payForm.date}
                onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))}
              />
            </Field>
            <Field label="Paid by">
              <select
                value={payForm.payment_method}
                onChange={(e) => setPayForm((f) => ({ ...f, payment_method: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="cash">Cash</option>
                <option value="bank">Bank transfer</option>
                <option value="upi">UPI</option>
                <option value="cheque">Cheque</option>
              </select>
            </Field>
          </div>
          <Field label="Note">
            <Input value={payForm.note} onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))} />
          </Field>
          {payEmp && payEmp.payroll.balance < 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              He has already been paid {fmtMoney(Math.abs(payEmp.payroll.balance))} more than he has earned this
              month. Recording this keeps the balance negative until he catches up.
            </p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="Delete employee?"
        message={confirm?.message}
        onConfirm={removeEmployee}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}