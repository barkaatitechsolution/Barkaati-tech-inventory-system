import { useEffect, useMemo, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
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
  Calculator,
  CalendarRange,
  FileText,
  Download,
  Printer
} from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import { fmtMoney, fmtDate, fmtDateTime, toDateInput, initials } from "../lib/format.js";

const localDate = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const firstOfMonth = () => localDate().slice(0, 8) + "01";

const currentMonth = () => localDate().slice(0, 7);

const hoursBetween = (from, to) => {
  if (!from || !to) return 0;
  const [ih, im] = String(from).split(":").map(Number);
  const [oh, om] = String(to).split(":").map(Number);
  const mins = (oh - ih) * 60 + (om - im);
  return mins > 0 ? mins / 60 : 0;
};

const fmtHours = (h) => {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${total % 60}m`;
};

const stripTime = (t) => (t ? String(t).slice(0, 5) : "");

// ── Attendance sheet helpers ─────────────────────────────────
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toISO = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Every calendar day in an inclusive range, so the sheet shows unmarked days too.
const eachDay = (from, to) => {
  const out = [];
  if (!from || !to || from > to) return out;
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end && out.length < 366) {
    out.push(toISO(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
};

const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()];

const sheetLabel = (iso) => {
  const meta = ATTR_STATUS_META[iso?.status];
  return meta ? meta.label : "Not marked";
};

// CSV with a UTF-8 BOM so Excel opens rupee/unicode content correctly.
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadCSV = (filename, rows) => {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const safeName = (s) => String(s || "employee").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

// Joins a sheet's records onto every calendar day in its range, so unmarked
// days still appear (a blank row in an attendance sheet is meaningful).
const sheetDaysOf = (sh) => {
  if (!sh) return [];
  const byDate = {};
  (sh.rows || []).forEach((r) => {
    byDate[String(r.date || "").slice(0, 10)] = r;
  });
  return eachDay(sh.from, sh.to).map((iso) => ({ iso, rec: byDate[iso] || null }));
};

const sheetStatsOf = (days) => {
  const s = { present: 0, half_day: 0, holiday: 0, leave: 0, absent: 0, unmarked: 0, minutes: 0 };
  days.forEach(({ rec }) => {
    if (!rec || s[rec.status] == null) {
      s.unmarked += 1;
      return;
    }
    s[rec.status] += 1;
    if (rec.status === "present" || rec.status === "half_day") {
      s.minutes += hoursBetween(stripTime(rec.time_in), stripTime(rec.time_out));
    }
  });
  s.total = days.length;
  s.paid = s.present + s.half_day * 0.5;
  return s;
};


// ── Salary auto-calculation ──────────────────────────────────
// Per-day salary = monthly salary ÷ number of days in that month
//   (dividing by a fixed 30.5 underpaid every 30-day month: 12,000 ÷ 30.5 = 393
//    × 30 = 11,790, so a fully-attended month silently lost ₹210.)
// Paid days = days in month − holiday − leave − absent + ½ × half days
// Balance to pay = gross + bonus − deduction − salary paid − advance taken
// A month with every day worked always earns the full stated monthly salary.
const AVG_MONTH_DAYS = 30.5;

// Exact per-day rate — kept unrounded so gross for a complete month is exact.
const perDayRate = (rate, days) => (Number(rate) || 0) / (Number(days) || AVG_MONTH_DAYS);

// Rounded rate, for display only.
const dailyRate = (rate, days) => Math.round(perDayRate(rate, days));

const monthBounds = (m) => {
  const [y, mo] = String(m || "").split("-").map(Number);
  if (!y || !mo) return { first: "", last: "", days: 0 };
  const last = new Date(y, mo, 0).getDate();
  const p = (n) => String(n).padStart(2, "0");
  return { first: `${y}-${p(mo)}-01`, last: `${y}-${p(mo)}-${p(last)}`, days: last };
};

const fmtMonth = (m) => {
  const [y, mo] = String(m || "").split("-").map(Number);
  if (!y || !mo) return m || "";
  return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

const ATTR_COUNTS = ["present", "half_day", "holiday", "leave", "absent"];

function salarySummary(emp, att, pays, monthStr) {
  const { first, last, days } = monthBounds(monthStr);
  const counts = { present: 0, half_day: 0, holiday: 0, leave: 0, absent: 0 };
  att.forEach((a) => {
    if (String(a.employee_id) !== String(emp.id)) return;
    const d = String(a.date || "").slice(0, 10);
    if (!first || d < first || d > last) return;
    if (counts[a.status] != null) counts[a.status] += 1;
  });
  const monthPays = pays.filter((p) => {
    if (String(p.employee_id) !== String(emp.id)) return false;
    const d = String(p.date || "").slice(0, 10);
    return !first || (d >= first && d <= last);
  });
  const sumType = (t) => monthPays.filter((p) => p.type === t).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const bonus = sumType("bonus");
  const deduction = sumType("deduction");
  const salaryPaid = sumType("salary");
  const marked = counts.present + counts.half_day + counts.holiday + counts.leave + counts.absent;
  const paidDays = days - counts.holiday - counts.leave - counts.absent + counts.half_day * 0.5;
  const isMonthly = emp.salary_type === "monthly";
  const daily = isMonthly ? perDayRate(emp.salary_rate, days) : 0;
  const gross = isMonthly
    ? Math.round(Math.max(0, Math.min(Number(emp.salary_rate) || 0, daily * Math.max(0, paidDays))))
    : 0;
  const advance = Number(emp.advances_pending) || 0;
  const balance = gross + bonus - deduction - salaryPaid - advance;
  return { ...counts, marked, days, paidDays, isMonthly, daily, gross, bonus, deduction, salaryPaid, advance, balance };
}

const EMP = {
  name: "",
  phone: "",
  email: "",
  address: "",
  designation: "",
  salary_type: "monthly",
  salary_rate: "",
  joining_date: "",
  notes: ""
};

const PAY = {
  type: "salary",
  amount: "",
  payment_method: "cash",
  date: localDate(),
  note: ""
};

const STATUS_OPTIONS = [
  { value: "present", label: "Present", color: "bg-emerald-50 text-emerald-700" },
  { value: "half_day", label: "Half day", color: "bg-amber-50 text-amber-700" },
  { value: "holiday", label: "Holiday", color: "bg-violet-50 text-violet-700" },
  { value: "leave", label: "Leave", color: "bg-slate-100 text-slate-600" },
  { value: "absent", label: "Absent", color: "bg-rose-50 text-rose-700" }
];

const ATTR_STATUS_META = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s]));

function PayStat({ value, label, className = "" }) {
  return (
    <div>
      <p className={`text-sm font-bold text-slate-800 ${className}`}>{value}</p>
      <p className="text-[10px] text-slate-400">{label}</p>
    </div>
  );
}

export default function Employee() {
  const [tab, setTab] = useState("staff"); // staff | attendance | payroll
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [reload, setReload] = useState(0);
  const bump = () => setReload((v) => v + 1);

  // staff
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [empOpen, setEmpOpen] = useState(false);
  const [empForm, setEmpForm] = useState(EMP);
  const [editingId, setEditingId] = useState(null);
  const [savingEmp, setSavingEmp] = useState(false);
  const [empFormError, setEmpFormError] = useState(null);

  // attendance
  const [attDate, setAttDate] = useState(localDate());
  const [attRows, setAttRows] = useState({});
  const [savingAtt, setSavingAtt] = useState(false);
  const [histFrom, setHistFrom] = useState(firstOfMonth());
  const [histTo, setHistTo] = useState(localDate());
  const [histEmpId, setHistEmpId] = useState("");
  const [history, setHistory] = useState([]);

  // individual attendance sheet
  const [sheet, setSheet] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // monthly salary
  const [salMonth, setSalMonth] = useState(currentMonth());
  const [monthAtt, setMonthAtt] = useState([]);
  const [monthPays, setMonthPays] = useState([]);

  // payroll
  const [payEmpId, setPayEmpId] = useState(null);
  const [payMonth, setPayMonth] = useState(currentMonth());
  const [payments, setPayments] = useState([]);
  const [payAtt, setPayAtt] = useState([]);
  const [payPays, setPayPays] = useState([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState(PAY);
  const [savingPay, setSavingPay] = useState(false);

  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.employees();
      setEmployees(list);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (loading) return;
    let active = true;
    (async () => {
      try {
        const list = await api.attendance(attDate, attDate);
        if (!active) return;
        const rows = {};
        employees.forEach((e) => {
          rows[e.id] = { status: "present", time_in: "", time_out: "", notes: "" };
        });
        list.forEach((a) => {
          if (rows[a.employee_id]) {
            rows[a.employee_id] = {
              status: a.status || "present",
              time_in: stripTime(a.time_in),
              time_out: stripTime(a.time_out),
              notes: a.notes || ""
            };
          }
        });
        setAttRows(rows);
      } catch (e) {
        setToast(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [attDate, employees.length]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const h = await api.attendance(histFrom, histTo, histEmpId || undefined);
        if (active) setHistory(h || []);
      } catch (e) {
        setToast(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [histFrom, histTo, histEmpId, employees.length, reload]);

  // Individual attendance sheet for the filtered employee and range.
  const sheetDays = useMemo(() => sheetDaysOf(sheet), [sheet]);
  const sheetStats = useMemo(() => sheetStatsOf(sheetDays), [sheetDays]);

  // Individual attendance sheet for one employee and a date range.
  const buildSheet = async (empId) => {
    const emp = employees.find((e) => String(e.id) === String(empId));
    if (!emp) return null;
    const rows = await api.attendance(histFrom, histTo, empId);
    return { emp, from: histFrom, to: histTo, rows: rows || [] };
  };

  const openSheet = async (empId) => {
    const id = empId || histEmpId;
    if (!id) return;
    setSheetOpen(true);
    setSheetLoading(true);
    setSheet({ emp: employees.find((e) => String(e.id) === String(id)) || null, from: histFrom, to: histTo, rows: [] });
    try {
      setSheet(await buildSheet(id));
    } catch (e) {
      setToast(e.message);
    } finally {
      setSheetLoading(false);
    }
  };

  const downloadSheet = async (empId) => {
    const id = empId || histEmpId;
    if (!id) return;
    setDownloading(true);
    try {
      const sh = await buildSheet(id);
      if (!sh) return;
      const days = sheetDaysOf(sh);
      const stats = sheetStatsOf(days);
      const head = [
        ["Employee", sh.emp.name],
        ["Designation", sh.emp.designation || "Employee"],
        ["Period", `${sh.from} to ${sh.to}`],
        [],
        ["Days in range", stats.total],
        ["Present", stats.present],
        ["Half days", stats.half_day],
        ["Holidays", stats.holiday],
        ["Leaves", stats.leave],
        ["Absents", stats.absent],
        ["Not marked", stats.unmarked],
        ["Total hours", fmtHours(stats.minutes)],
        [],
        ["Date", "Day", "Status", "Time in", "Time out", "Hours", "Notes"]
      ];
      const body = days.map(({ iso, rec }) => [
        iso,
        weekdayOf(iso),
        sheetLabel(rec),
        stripTime(rec?.time_in),
        stripTime(rec?.time_out),
        rec ? fmtHours(hoursBetween(stripTime(rec.time_in), stripTime(rec.time_out))) : "",
        rec?.notes || ""
      ]);
      downloadCSV(`attendance-${safeName(sh.emp.name)}-${sh.from}-to-${sh.to}.csv`, [...head, ...body]);
      setToast(`Attendance sheet downloaded for ${sh.emp.name}`);
    } catch (e) {
      setToast(e.message);
    } finally {
      setDownloading(false);
    }
  };

  const printSheet = () => {
    document.body.classList.add("printing-sheet");
    const cleanup = () => {
      document.body.classList.remove("printing-sheet");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(cleanup, 1500); // engines that never fire afterprint
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const { first, last } = monthBounds(salMonth);
      if (!first) return;
      try {
        const [att, pays] = await Promise.all([api.attendance(first, last), api.payments(first, last)]);
        if (!active) return;
        setMonthAtt(att || []);
        setMonthPays(pays || []);
      } catch (e) {
        setToast(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [salMonth, employees.length, reload]);

  const filteredStaff = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return employees.filter((e) => {
      if (!q) return true;
      return [e.name, e.phone, e.designation].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [employees, debouncedSearch]);

  const salaryMap = useMemo(() => {
    const map = {};
    employees.forEach((e) => {
      map[e.id] = salarySummary(e, monthAtt, monthPays, salMonth);
    });
    return map;
  }, [employees, monthAtt, monthPays, salMonth]);

  const payEmp = employees.find((e) => e.id === payEmpId) || null;

  const paySummary = useMemo(
    () => (payEmp ? salarySummary(payEmp, payAtt, payPays, payMonth) : null),
    [payEmp, payAtt, payPays, payMonth]
  );

  useEffect(() => {
    if (!tab || !employees.length) return;
    if (tab === "payroll" && !payEmpId) setPayEmpId(employees[0].id);
  }, [tab, employees]);

  useEffect(() => {
    if (!payEmpId) return;
    let active = true;
    (async () => {
      try {
        const list = await api.employeePayments(payEmpId);
        if (active) setPayments(list || []);
      } catch (e) {
        setToast(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [payEmpId]);

  useEffect(() => {
    if (!payEmpId) return;
    let active = true;
    (async () => {
      const { first, last } = monthBounds(payMonth);
      if (!first) return;
      try {
        const [att, pays] = await Promise.all([
          api.attendance(first, last, payEmpId),
          api.payments(first, last, payEmpId)
        ]);
        if (!active) return;
        setPayAtt(att || []);
        setPayPays(pays || []);
      } catch (e) {
        setToast(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [payEmpId, payMonth, employees.length, reload]);

  const openCreateEmp = () => {
    setEditingId(null);
    setEmpForm(EMP);
    setEmpFormError(null);
    setEmpOpen(true);
  };

  const openEditEmp = (e) => {
    setEditingId(e.id);
    setEmpForm({
      name: e.name || "",
      phone: e.phone || "",
      email: e.email || "",
      address: e.address || "",
      designation: e.designation || "",
      salary_type: e.salary_type || "monthly",
      salary_rate: e.salary_rate != null ? String(e.salary_rate) : "",
      joining_date: e.joining_date ? toDateInput(e.joining_date) : "",
      notes: e.notes || ""
    });
    setEmpFormError(null);
    setEmpOpen(true);
  };

  const saveEmp = async () => {
    if (!empForm.name.trim()) {
      setEmpFormError("Name is required");
      return;
    }
    setSavingEmp(true);
    try {
      if (editingId) {
        await api.updateEmployee(editingId, empForm);
        setToast("Employee updated");
      } else {
        await api.createEmployee(empForm);
        setToast("Employee added");
      }
      setEmpOpen(false);
      await load();
    } catch (e) {
      setEmpFormError(e.message);
    } finally {
      setSavingEmp(false);
    }
  };

  const removeEmployee = async () => {
    try {
      await api.deleteEmployee(confirm.id);
      setConfirm(null);
      setToast("Employee removed");
      await load();
      if (payEmpId === confirm.id) {
        setPayEmpId(null);
        setPayments([]);
      }
    } catch (e) {
      setToast(e.message);
    }
  };

  const setAtt = (id, key, value) =>
    setAttRows((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));

  const markAllPresent = () => {
    const next = {};
    employees.forEach((e) => {
      next[e.id] = { ...(attRows[e.id] || {}), status: "present" };
    });
    setAttRows(next);
  };

  const saveAttendance = async () => {
    setSavingAtt(true);
    try {
      for (const e of employees) {
        const r = attRows[e.id] || { status: "present", time_in: "", time_out: "", notes: "" };
        await api.saveAttendance({
          employee_id: e.id,
          date: attDate,
          status: r.status,
          time_in: r.time_in || null,
          time_out: r.time_out || null,
          notes: r.notes || null
        });
      }
      setToast("Attendance saved for " + attDate);
      bump();
    } catch (e) {
      setToast(e.message);
    } finally {
      setSavingAtt(false);
    }
  };

  const removeAttendance = async () => {
    try {
      await api.deleteAttendance(confirm.id);
      setConfirm(null);
      setToast("Attendance entry removed");
      bump();
    } catch (e) {
      setToast(e.message);
    }
  };

  const openPay = () => {
    setPayForm(PAY);
    setPayOpen(true);
  };

  const savePay = async () => {
    const amount = Number(payForm.amount);
    if (!payEmpId || !amount || amount <= 0) return;
    setSavingPay(true);
    try {
      await api.createEmployeePayment(payEmpId, payForm);
      setPayOpen(false);
      setToast("Payment recorded");
      const [, emps] = await Promise.all([api.employeePayments(payEmpId), api.employees()]);
      setEmployees(emps);
      bump();
    } catch (e) {
      setToast(e.message);
    } finally {
      setSavingPay(false);
    }
  };

  const removePayment = async () => {
    try {
      await api.deletePayment(confirm.id);
      setConfirm(null);
      setToast("Payment removed");
      const [, emps] = await Promise.all([api.employeePayments(payEmpId), api.employees()]);
      setEmployees(emps);
      bump();
    } catch (e) {
      setToast(e.message);
    }
  };

  const tabs = [
    { key: "staff", label: "Staff", icon: UserCog },
    { key: "attendance", label: "Attendance", icon: CalendarDays },
    { key: "payroll", label: "Salary & Payments", icon: Wallet }
  ];

  const typeBadge = (t) => {
    const map = {
      salary: "bg-emerald-50 text-emerald-700",
      advance: "bg-amber-50 text-amber-700",
      advance_recovery: "bg-sky-50 text-sky-700",
      bonus: "bg-violet-50 text-violet-700",
      deduction: "bg-rose-50 text-rose-700"
    };
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${map[t] || "bg-slate-100 text-slate-600"}`}>
        {t}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <UserCog className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Employees</p>
            <p className="text-xs text-slate-500">
              {employees.length} staff · attendance, salary auto-calculation and payments
            </p>
          </div>
        </div>
        {tab === "staff" && (
          <Button onClick={openCreateEmp} className="w-full sm:w-auto">
            <Plus className="h-4 w-4" /> Add Employee
          </Button>
        )}
        {tab === "payroll" && payEmp && (
          <Button onClick={openPay} className="w-full sm:w-auto">
            <Plus className="h-4 w-4" /> Record Payment
          </Button>
        )}
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
                active
                  ? "border-indigo-500 text-indigo-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* ── STAFF ─────────────────────────────────────────────── */}
      {tab === "staff" && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone or role…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              Loading…
            </div>
          ) : filteredStaff.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm font-semibold text-slate-600">No employees yet</p>
              <p className="mt-1 text-xs text-slate-400">Add your first employee to start tracking attendance and salary.</p>
              <Button className="mt-4" onClick={openCreateEmp}>
                <UserPlus className="h-4 w-4" /> Add Employee
              </Button>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredStaff.map((e) => {
                const s = salaryMap[e.id] || salarySummary(e, monthAtt, monthPays, salMonth);
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
                            {e.designation || "Employee"} {e.phone && <span> · {e.phone}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => openEditEmp(e)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() =>
                            setConfirm({ id: e.id, type: "employee", name: e.name, message: `Delete ${e.name}? This also removes their attendance and payment records.` })
                          }
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {s.isMonthly ? (
                        <>
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                            {fmtMoney(e.salary_rate)}/month
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                            <Calculator className="h-3 w-3" /> ≈ {fmtMoney(s.daily)}/day
                          </span>
                        </>
                      ) : (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                          Hourly {fmtMoney(e.salary_rate)}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                        <Clock className="h-3 w-3" /> {s.present} present
                      </span>
                    </div>

                    <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                      {s.isMonthly ? (
                        <>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">Earned in {fmtMonth(salMonth)}</span>
                            <span className="font-semibold text-slate-700">{fmtMoney(s.gross)}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">Advance taken</span>
                            <span className="font-semibold text-amber-600">{fmtMoney(s.advance)}</span>
                          </div>
                          <div
                            className={`mt-1 flex items-center justify-between rounded-xl px-3 py-2 ${
                              s.balance >= 0 ? "bg-emerald-50" : "bg-rose-50"
                            }`}
                          >
                            <span className={`text-xs font-semibold ${s.balance >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                              Balance to pay
                            </span>
                            <span
                              className={`text-base font-bold ${s.balance >= 0 ? "text-emerald-700" : "text-rose-600"}`}
                            >
                              {fmtMoney(s.balance)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">Paid via ledger</span>
                          <span className="font-semibold text-slate-700">{fmtMoney(e.salary_paid || 0)}</span>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ATTENDANCE ────────────────────────────────────────── */}
      {tab === "attendance" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Date">
              <Input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} className="w-44" />
            </Field>
            <Button variant="soft" onClick={markAllPresent}>
              <Check className="h-4 w-4" /> Mark all present
            </Button>
            <Button onClick={saveAttendance} disabled={savingAtt}>
              {savingAtt ? "Saving…" : "Save attendance"}
            </Button>
          </div>

          {employees.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-400">Add employees first to mark attendance.</Card>
          ) : (
            <Card className="space-y-2 p-0">
              <div className="space-y-2 p-3 sm:hidden">
                {employees.map((e) => {
                  const r = attRows[e.id] || { status: "present", time_in: "", time_out: "", notes: "" };
                  const hrs = hoursBetween(stripTime(r.time_in), stripTime(r.time_out));
                  return (
                    <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-800">{e.name}</p>
                          <p className="truncate text-[11px] text-slate-400">{e.designation || "Employee"}</p>
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
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Input
                          type="time"
                          value={r.time_in}
                          onChange={(ev) => setAtt(e.id, "time_in", ev.target.value)}
                          className="!px-2 !py-1.5 text-xs"
                        />
                        <Input
                          type="time"
                          value={r.time_out}
                          onChange={(ev) => setAtt(e.id, "time_out", ev.target.value)}
                          className="!px-2 !py-1.5 text-xs"
                        />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            hrs > 0 ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          {hrs > 0 ? fmtHours(hrs) : "—"}
                        </span>
                        <input
                          value={r.notes || ""}
                          onChange={(ev) => setAtt(e.id, "notes", ev.target.value)}
                          placeholder="Notes (optional)"
                          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none transition focus:border-indigo-400"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-semibold">Employee</th>
                    <th className="px-2 py-3 font-semibold">Status</th>
                    <th className="px-2 py-3 font-semibold">Time in</th>
                    <th className="px-2 py-3 font-semibold">Time out</th>
                    <th className="px-2 py-3 font-semibold">Hours</th>
                    <th className="hidden px-2 py-3 font-semibold sm:table-cell">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => {
                    const r = attRows[e.id] || { status: "present", time_in: "", time_out: "", notes: "" };
                    const hrs = hoursBetween(stripTime(r.time_in), stripTime(r.time_out));
                    return (
                      <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-slate-800">{e.name}</p>
                          <p className="text-[11px] text-slate-400">{e.designation || ""}</p>
                        </td>
                        <td className="px-2 py-2.5">
                          <select
                            value={r.status}
                            onChange={(ev) => setAtt(e.id, "status", ev.target.value)}
                            className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium outline-none transition focus:border-indigo-400"
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2.5">
                          <Input
                            type="time"
                            value={r.time_in}
                            onChange={(ev) => setAtt(e.id, "time_in", ev.target.value)}
                            className="w-28 !px-2 !py-1.5 text-xs"
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <Input
                            type="time"
                            value={r.time_out}
                            onChange={(ev) => setAtt(e.id, "time_out", ev.target.value)}
                            className="w-28 !px-2 !py-1.5 text-xs"
                          />
                        </td>
                        <td className="px-2 py-2.5 text-xs font-bold text-slate-600">
                          {hrs > 0 ? fmtHours(hrs) : "—"}
                        </td>
                        <td className="hidden px-2 py-2.5 sm:table-cell">
                          <input
                            value={r.notes || ""}
                            onChange={(ev) => setAtt(e.id, "notes", ev.target.value)}
                            placeholder="Optional"
                            className="w-full max-w-[180px] rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none transition focus:border-indigo-400"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </Card>
          )}

          {/* Monthly salary auto-calculation */}
          <Card className="space-y-4 p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
              <div>
                <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <CalendarRange className="h-4 w-4 text-indigo-500" /> Monthly salary · {fmtMonth(salMonth)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Auto-calculated from attendance · per-day = monthly ÷ days in that month

                </p>
              </div>
              <Input type="month" value={salMonth} onChange={(e) => setSalMonth(e.target.value)} className="w-40" />
            </div>

            {employees.length === 0 ? (
              <p className="px-4 pb-4 text-center text-sm text-slate-400">Add employees first to see salaries.</p>
            ) : (
              <>
                {loading ? (
                  <p className="px-4 pb-4 text-center text-sm text-slate-400">Loading…</p>
                ) : (
                  <div className="grid gap-3 px-4 pb-4 sm:px-5 md:grid-cols-2 xl:grid-cols-3">
                    {employees.map((e) => {
                      const s = salaryMap[e.id] || salarySummary(e, monthAtt, monthPays, salMonth);
                      return (
                        <div key={e.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-800">{e.name}</p>
                              <p className="truncate text-[11px] text-slate-400">
                                {e.designation || "Employee"}
                                {s.isMonthly && <span> · {fmtMoney(s.daily)}/day</span>}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p
                                className={`text-lg font-bold ${
                                  s.isMonthly ? (s.balance >= 0 ? "text-emerald-600" : "text-rose-600") : "text-slate-500"
                                }`}
                              >
                                {s.isMonthly ? fmtMoney(s.balance) : "—"}
                              </p>
                              <p className="text-[10px] text-slate-400">
                                {s.isMonthly ? "Balance to pay" : "Hourly · ledger"}
                              </p>
                            </div>
                          </div>

                          {s.isMonthly ? (
                            <>
                              <div className="flex flex-wrap gap-1 text-[10px] font-semibold">
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{s.days} days</span>
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{s.present} present</span>
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{s.half_day} half</span>
                                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">{s.holiday} holiday</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{s.leave} leave</span>
                                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-600">{s.absent} absent</span>
                              </div>

                              <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-400">Per day</span>
                                  <span className="font-semibold text-slate-700">{fmtMoney(s.daily)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-400">Paid days</span>
                                  <span className="font-semibold text-slate-700">{s.paidDays}</span>
                                </div>
                                <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
                                  <span className="font-medium text-slate-600">Gross earned</span>
                                  <span className="font-bold text-slate-800">{fmtMoney(s.gross)}</span>
                                </div>
                              </div>

                              <div className="space-y-1 text-[11px] text-slate-500">
                                <div className="flex justify-between">
                                  <span>Advance taken</span>
                                  <span className="font-semibold text-amber-600">− {fmtMoney(s.advance)}</span>
                                </div>
                                {s.salaryPaid > 0 && (
                                  <div className="flex justify-between">
                                    <span>Salary paid</span>
                                    <span className="font-semibold text-sky-600">− {fmtMoney(s.salaryPaid)}</span>
                                  </div>
                                )}
                                {s.bonus > 0 && (
                                  <div className="flex justify-between">
                                    <span>Bonus</span>
                                    <span className="font-semibold text-violet-600">+ {fmtMoney(s.bonus)}</span>
                                  </div>
                                )}
                                {s.deduction > 0 && (
                                  <div className="flex justify-between">
                                    <span>Deduction</span>
                                    <span className="font-semibold text-rose-600">− {fmtMoney(s.deduction)}</span>
                                  </div>
                                )}
                              </div>

                              <p className="text-[10px] text-slate-300">
                                {s.marked} of {s.days} days marked
                              </p>
                            </>
                          ) : (
                            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400">
                              Hourly {fmtMoney(e.salary_rate)}/hour — paid through the payment ledger.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="border-t border-slate-100 px-4 pb-4 pt-3 text-[11px] leading-relaxed text-slate-400 sm:px-5">
                  Per-day salary = monthly ÷ days in that month (a fully-worked month earns the full salary)
                  · Paid days = days − holidays − leaves − absents + ½ × half days
                  · Balance = gross + bonus − deduction − salary paid − advance taken

                </p>
              </>
            )}
          </Card>

          <div className="flex flex-wrap items-end gap-4">
            <Field label="From">
              <Input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} className="w-44" />
            </Field>
            <Field label="To">
              <Input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)} className="w-44" />
            </Field>
            <Field label="Employee">
              <select
                value={histEmpId}
                onChange={(e) => setHistEmpId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 sm:w-56"
              >
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.designation ? ` — ${e.designation}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="soft" onClick={() => openSheet()} disabled={!histEmpId}>
              <FileText className="h-4 w-4" /> View sheet
            </Button>
            <Button variant="soft" onClick={() => downloadSheet()} disabled={!histEmpId || downloading}>
              <Download className="h-4 w-4" /> {downloading ? "Preparing…" : "Download CSV"}
            </Button>
          </div>

          {!histEmpId && employees.length > 0 && (
            <p className="-mt-2 text-xs text-slate-400">
              Pick an employee above to view or download their individual attendance sheet.
            </p>
          )}

          {history.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-400">No attendance records in this range.</Card>
          ) : (
            <>
              <div className="space-y-2 sm:hidden">
                {history.map((h) => {
                  const meta = ATTR_STATUS_META[h.status] || ATTR_STATUS_META.present;
                  const hrs = hoursBetween(stripTime(h.time_in), stripTime(h.time_out));
                  return (
                    <div key={h.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-700">{fmtDate(h.date)}</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.color}`}>{meta.label}</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-800">{h.employee_name}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>
                          {stripTime(h.time_in) || "—"} → {stripTime(h.time_out) || "—"}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={`font-bold ${hrs > 0 ? "text-slate-600" : "text-slate-300"}`}>{hrs > 0 ? fmtHours(hrs) : "—"}</span>
                          <button
                            onClick={() => setConfirm({ id: h.id, type: "attendance", name: `${h.employee_name} · ${fmtDate(h.date)}` })}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Card className="hidden space-y-1 p-0 sm:block">
                <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-2 py-3 font-semibold">Employee</th>
                    <th className="px-2 py-3 font-semibold">Status</th>
                    <th className="px-2 py-3 font-semibold">In</th>
                    <th className="px-2 py-3 font-semibold">Out</th>
                    <th className="px-2 py-3 font-semibold">Hours</th>
                    <th className="px-2 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const meta = ATTR_STATUS_META[h.status] || ATTR_STATUS_META.present;
                    const hrs = hoursBetween(stripTime(h.time_in), stripTime(h.time_out));
                    return (
                      <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDate(h.date)}</td>
                        <td className="px-2 py-2.5 font-semibold text-slate-800">{h.employee_name}</td>
                        <td className="px-2 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.color}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-xs text-slate-600">{stripTime(h.time_in) || "—"}</td>
                        <td className="px-2 py-2.5 text-xs text-slate-600">{stripTime(h.time_out) || "—"}</td>
                        <td className="px-2 py-2.5 text-xs font-bold text-slate-600">{hrs > 0 ? fmtHours(hrs) : "—"}</td>
                        <td className="px-2 py-2.5 text-right">
                          <button
                            onClick={() => setConfirm({ id: h.id, type: "attendance", name: `${h.employee_name} · ${fmtDate(h.date)}` })}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── PAYROLL ───────────────────────────────────────────── */}
      {tab === "payroll" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Employee">
              <select
                value={payEmpId || ""}
                onChange={(e) => setPayEmpId(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 sm:w-64"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.designation || "Employee"})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Salary month">
              <Input type="month" value={payMonth} onChange={(e) => setPayMonth(e.target.value)} className="w-40" />
            </Field>
            {payEmp && (
              <div className="pb-1 text-xs text-slate-400">
                {payEmp.salary_type === "hourly" ? `Hourly ` : `Monthly `}
                <span className="font-bold text-slate-700">{fmtMoney(payEmp.salary_rate)}</span>
                {payEmp.joining_date && <> · joined {fmtDate(payEmp.joining_date)}</>}
              </div>
            )}
          </div>

          {!payEmp ? (
            <Card className="p-8 text-center text-sm text-slate-400">Add employees first to record payments.</Card>
          ) : (
            <>
              {paySummary && (
                <Card className="overflow-hidden p-0">
                  <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-slate-400">
                          Balance to pay — {fmtMonth(payMonth)} · {payEmp.name}
                        </p>
                        <p
                          className={`mt-0.5 text-2xl font-bold tracking-tight ${
                            paySummary.balance >= 0 ? "text-slate-900" : "text-rose-600"
                          }`}
                        >
                          {fmtMoney(paySummary.balance)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {paySummary.balance >= 0 ? `To be paid to ${payEmp.name}` : `${payEmp.name} owes the store`}
                        </p>
                      </div>
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                        <Wallet className="h-5 w-5" />
                      </div>
                    </div>
                  </div>
                  {paySummary.isMonthly ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-4 sm:px-5">
                      <PayStat value={fmtMoney(paySummary.gross)} label="Gross earned" />
                      <PayStat value={fmtMoney(paySummary.daily)} label="Per day" />
                      <PayStat value={paySummary.paidDays} label="Paid days" />
                      <PayStat value={fmtMoney(paySummary.advance)} label="Advance taken" className="text-amber-600" />
                      <PayStat value={fmtMoney(paySummary.salaryPaid)} label="Salary paid" className="text-sky-600" />
                      <PayStat value={fmtMoney(paySummary.bonus)} label="Bonus" className="text-violet-600" />
                      <PayStat value={fmtMoney(paySummary.deduction)} label="Deduction" className="text-rose-600" />
                      <PayStat
                        value={`${paySummary.present} / ${paySummary.holiday} / ${paySummary.half_day}`}
                        label="Present / Holiday / Half"
                      />
                    </div>
                  ) : (
                    <p className="px-4 py-4 text-xs text-slate-400 sm:px-5">
                      Hourly {fmtMoney(payEmp.salary_rate)}/hour — paid through the payment ledger below.
                    </p>
                  )}
                </Card>
              )}

              <Card className="space-y-1 p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Payment ledger</p>
                  <p className="text-xs text-slate-400">{payments.length} record{payments.length === 1 ? "" : "s"}</p>
                </div>
                {payments.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">No payments recorded for this employee.</p>
                ) : (
                  <>
                    <div className="space-y-2 p-3 sm:hidden">
                      {payments.map((p) => (
                        <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            {typeBadge(p.type)}
                            <button
                              onClick={() => setConfirm({ id: p.id, type: "payment", name: `${p.type} of ${fmtMoney(p.amount)}` })}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="mt-1.5 text-lg font-bold text-slate-800">{fmtMoney(p.amount)}</p>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {fmtDateTime(p.date)}
                            {p.payment_method && <> · {p.payment_method}</>}
                            {p.note && <span className="mt-0.5 block truncate">{p.note}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto sm:block">
                      <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-2 py-3 font-semibold">Type</th>
                        <th className="px-2 py-3 font-semibold">Amount</th>
                        <th className="hidden px-2 py-3 font-semibold sm:table-cell">Method</th>
                        <th className="hidden px-2 py-3 font-semibold md:table-cell">Note</th>
                        <th className="px-2 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                          <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDateTime(p.date)}</td>
                          <td className="px-2 py-2.5">{typeBadge(p.type)}</td>
                          <td className="px-2 py-2.5 font-bold text-slate-800">{fmtMoney(p.amount)}</td>
                          <td className="hidden px-2 py-2.5 text-xs text-slate-500 sm:table-cell">{p.payment_method}</td>
                          <td className="hidden max-w-[220px] truncate px-2 py-2.5 text-xs text-slate-500 md:table-cell">{p.note || "—"}</td>
                          <td className="px-2 py-2.5 text-right">
                            <button
                              onClick={() => setConfirm({ id: p.id, type: "payment", name: `${p.type} of ${fmtMoney(p.amount)}` })}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                    </div>
                  </>
                )}
              </Card>

              <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <Phone className="h-4 w-4 shrink-0" />
                <p>
                  Record <b>Middle payment / Advance</b> for money given to an employee during the month, then{" "}
                  <b>Advance recovery</b> when it is settled from salary — it is subtracted from the balance to pay.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Individual attendance sheet ───────────────────────── */}
      <Modal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        wide
        title={sheet?.emp ? `Attendance sheet — ${sheet.emp.name}` : "Attendance sheet"}
        subtitle={sheet ? `${fmtDate(sheet.from)} → ${fmtDate(sheet.to)}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSheetOpen(false)}>
              Close
            </Button>
            <Button variant="soft" onClick={printSheet} disabled={sheetLoading}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button onClick={() => downloadSheet(sheet?.emp?.id)} disabled={sheetLoading || downloading}>
              <Download className="h-4 w-4" /> Download CSV
            </Button>
          </>
        }
      >
        <div className="print-area space-y-4">
          {sheetLoading ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading attendance…</p>
          ) : !sheet?.emp ? (
            <p className="py-10 text-center text-sm text-slate-400">No employee selected.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{sheet.emp.name}</p>
                  <p className="text-xs text-slate-500">
                    {sheet.emp.designation || "Employee"}
                    {sheet.emp.phone ? ` · ${sheet.emp.phone}` : ""}
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  {fmtDate(sheet.from)} → {fmtDate(sheet.to)}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {[
                  { k: "Total", v: sheetStats.total, cls: "text-slate-900" },
                  { k: "Present", v: sheetStats.present, cls: "text-emerald-600" },
                  { k: "Half", v: sheetStats.half_day, cls: "text-amber-600" },
                  { k: "Holiday", v: sheetStats.holiday, cls: "text-sky-600" },
                  { k: "Leave", v: sheetStats.leave, cls: "text-violet-600" },
                  { k: "Absent", v: sheetStats.absent, cls: "text-rose-600" }
                ].map((b) => (
                  <div key={b.k} className="rounded-xl bg-slate-50 px-2.5 py-2 text-center">
                    <p className={`text-base font-bold ${b.cls}`}>{b.v}</p>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{b.k}</p>
                  </div>
                ))}
              </div>

              {sheetStats.unmarked > 0 && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {sheetStats.unmarked} day{sheetStats.unmarked > 1 ? "s" : ""} in this range {sheetStats.unmarked > 1 ? "have" : "has"} no
                  attendance marked.
                </p>
              )}

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="px-2.5 py-2 font-semibold">Date</th>
                      <th className="px-2 py-2 font-semibold">Day</th>
                      <th className="px-2 py-2 font-semibold">Status</th>
                      <th className="px-2 py-2 font-semibold">In</th>
                      <th className="px-2 py-2 font-semibold">Out</th>
                      <th className="px-2 py-2 font-semibold">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetDays.map(({ iso, rec }) => {
                      const meta = ATTR_STATUS_META[rec?.status];
                      const hrs = hoursBetween(stripTime(rec?.time_in), stripTime(rec?.time_out));
                      return (
                        <tr key={iso} className="border-t border-slate-100">
                          <td className="px-2.5 py-1.5 text-slate-600">{iso}</td>
                          <td className="px-2 py-1.5 text-slate-500">{weekdayOf(iso)}</td>
                          <td className="px-2 py-1.5">
                            <span
                              className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                                meta ? meta.color : "bg-slate-100 text-slate-400"
                              }`}
                            >
                              {meta ? meta.label : "Not marked"}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">{stripTime(rec?.time_in) || "—"}</td>
                          <td className="px-2 py-1.5 text-slate-600">{stripTime(rec?.time_out) || "—"}</td>
                          <td className="px-2 py-1.5 font-semibold text-slate-700">{hrs > 0 ? fmtHours(hrs) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-slate-400">
                Total marked hours: {fmtHours(sheetStats.minutes)} · Paid days: {sheetStats.paid}
              </p>
            </>
          )}
        </div>
      </Modal>

      {/* ── Modals ────────────────────────────────────────────── */}
      <Modal
        open={empOpen}
        onClose={() => setEmpOpen(false)}
        title={editingId ? "Edit Employee" : "Add Employee"}
        subtitle="Details, role and salary used for payroll"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEmpOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEmp} disabled={savingEmp}>
              {savingEmp ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {empFormError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{empFormError}</div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} placeholder="e.g. Rahul Sharma" />
            </Field>
            <Field label="Designation">
              <Input value={empForm.designation} onChange={(e) => setEmpForm({ ...empForm, designation: e.target.value })} placeholder="e.g. Salesman" />
            </Field>
            <Field label="Phone">
              <Input value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} placeholder="Phone number" />
            </Field>
            <Field label="Email">
              <Input value={empForm.email} onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })} placeholder="Email" />
            </Field>
            <Field label="Address">
              <Input value={empForm.address} onChange={(e) => setEmpForm({ ...empForm, address: e.target.value })} placeholder="Address" />
            </Field>
            <Field label="Joining date">
              <Input type="date" value={empForm.joining_date} onChange={(e) => setEmpForm({ ...empForm, joining_date: e.target.value })} />
            </Field>
            <Field label="Salary type">
              <select
                value={empForm.salary_type}
                onChange={(e) => setEmpForm({ ...empForm, salary_type: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400"
              >
                <option value="monthly">Monthly salary</option>
                <option value="hourly">Hourly rate</option>
              </select>
            </Field>
            <Field label={empForm.salary_type === "hourly" ? "Hourly rate" : "Monthly salary"}>
              <Input
                type="number"
                min="0"
                value={empForm.salary_rate}
                onChange={(e) => setEmpForm({ ...empForm, salary_rate: e.target.value })}
                placeholder="0"
              />
            </Field>
            {empForm.salary_type === "monthly" && Number(empForm.salary_rate) > 0 && (() => {
              const formDays = monthBounds(salMonth).days || AVG_MONTH_DAYS;
              return (
                <p className="text-[11px] text-slate-400 sm:col-span-2">
                  Per-day salary is auto-calculated as{" "}
                  <b className="text-slate-600">
                    {fmtMoney(dailyRate(empForm.salary_rate, formDays))}/day
                  </b>{" "}
                  ({fmtMoney(empForm.salary_rate)} ÷ {formDays} days in {fmtMonth(salMonth)}). Working every day of a
                  month earns the full salary.
                </p>
              );
            })()}
            <div className="sm:col-span-2">
              <Field label="Notes">
                <Textarea
                  rows={2}
                  value={empForm.notes}
                  onChange={(e) => setEmpForm({ ...empForm, notes: e.target.value })}
                  placeholder="Anything to remember"
                />
              </Field>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Record payment"
        subtitle={payEmp ? `For ${payEmp.name}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePay} disabled={savingPay}>
              {savingPay ? "Saving…" : "Save payment"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <select
              value={payForm.type}
              onChange={(e) => setPayForm({ ...payForm, type: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400"
            >
              <option value="salary">Salary</option>
              <option value="advance">Middle payment / Advance</option>
              <option value="advance_recovery">Advance recovery / Settle</option>
              <option value="bonus">Bonus</option>
              <option value="deduction">Deduction</option>
            </select>
          </Field>
          <Field label="Amount" required>
            <Input type="number" min="0" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Date">
            <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
          </Field>
          <Field label="Payment method">
            <select
              value={payForm.payment_method}
              onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400"
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank transfer</option>
              <option value="card">Card</option>
              <option value="online">Online</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note">
              <Input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="Optional note" />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm ? `Delete ${confirm.type}?` : ""}
        message={confirm?.message || `Delete ${confirm?.name || "this"}? This cannot be undone.`}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.type === "employee") removeEmployee();
          else if (confirm?.type === "attendance") removeAttendance();
          else if (confirm?.type === "payment") removePayment();
        }}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}