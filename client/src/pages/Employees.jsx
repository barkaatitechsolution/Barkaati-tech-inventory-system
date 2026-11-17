import { useEffect, useMemo, useRef, useState } from "react";
import {
  UserCog,
  Plus,
  Search,
  Pencil,
  Trash2,
  Clock,
  Star,
  FolderOpen,
  TrendingUp,
  PiggyBank,
  FileText,
  Upload,
  Image as ImageIcon,
  X
} from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DraftBanner from "../components/DraftBanner.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import TimeInput from "../components/TimeInput.jsx";
import { fmtMoney, fmtDate, fmtMonth, toDateInput, initials } from "../lib/format.js";
import { timeOptions } from "../lib/hours.js";
import { useFormDraft, useDraftReopen } from "../lib/formDraft.js";
import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_META,
  PAY_MODES,
  RANKS,
  blankEmployee,
  currentMonth,
  stripTime
} from "../lib/employees.js";

const SELECT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

function Stars({ n = 0 }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${n} of 5 stars`}>
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
  const tone =
    {
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

function BalancePill({ label, value }) {
  const owed = Number(value) > 0;
  return (
    <div className={`rounded-xl px-3 py-2 ${owed ? "bg-emerald-50" : "bg-rose-50"}`}>
      <p className={`text-[10px] font-semibold ${owed ? "text-emerald-600" : "text-rose-500"}`}>
        {label}
      </p>
      <p className={`text-base font-bold ${owed ? "text-emerald-700" : "text-rose-600"}`}>
        {fmtMoney(value)}
      </p>
    </div>
  );
}

export default function Employees({ onNavigate }) {
  const [month] = useState(currentMonth);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankEmployee);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [confirm, setConfirm] = useState(null);

  const draft = useFormDraft({
    key: `employees:${editing ? `edit:${editing.id}` : "new"}`,
    value: { form, editing, photoFile },
    apply: (v) => {
      if (v.form) setForm(v.form);
      if (v.editing !== undefined) setEditing(v.editing);
      if (v.photoFile instanceof File) {
        setPhotoFile(v.photoFile);
      } else {
        setPhotoFile(null);
        setPhotoPreview(v.editing?.photo_path || "");
      }
    },
    active: formOpen
  });

  useDraftReopen({
    prefix: "employees",
    open: formOpen,
    session: editing?.id ?? null,
    onReopen: (id) => {
      setEditing(id ? { id } : null);
      setFormOpen(true);
    }
  });

  const toastTimer = useRef(null);
  const say = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  };

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const load = async () => {
    try {
      const rows = await api.employees(month);
      setEmployees(Array.isArray(rows) ? rows : []);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load employees");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!formOpen || !photoFile) return undefined;
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [formOpen, photoFile]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      const matchesQuery =
        !q ||
        [e.name, e.designation, e.phone, e.email, e.rank, e.status]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      const matchesStatus = !statusFilter || e.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [employees, search, statusFilter]);

  const totals = useMemo(() => {
    return employees.reduce(
      (acc, e) => {
        if (e.status === "active") acc.active += 1;
        acc.earned += Number(e.payroll?.accrual) || 0;
        acc.balance += Number(e.payroll?.balance) || 0;
        acc.documents += Number(e.documents) || 0;
        return acc;
      },
      { active: 0, earned: 0, balance: 0, documents: 0 }
    );
  }, [employees]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm(blankEmployee());
    setPhotoFile(null);
    setPhotoPreview("");
    setFormOpen(true);
  };

  const openEdit = (employee) => {
    setEditing(employee);
    setForm({
      ...blankEmployee(),
      ...employee,
      salary_rate: employee.salary_rate ?? "",
      pf_rate: employee.pf_rate ?? 12,
      stars: Number(employee.stars) || 1,
      shift_start: stripTime(employee.shift_start),
      shift_end: stripTime(employee.shift_end),
      joining_date: toDateInput(employee.joining_date),
      starting_date: toDateInput(employee.starting_date),
      last_working_date: toDateInput(employee.last_working_date),
      date_of_birth: toDateInput(employee.date_of_birth),
      pf_enabled: !!employee.pf_enabled
    });
    setPhotoFile(null);
    setPhotoPreview(employee.photo_path || "");
    setFormOpen(true);
  };

  const pickPhoto = (file) => {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setError("Profile photo must be an image.");
      return;
    }
    setPhotoFile(file);
  };

  const removePhoto = async () => {
    if (photoFile) {
      setPhotoFile(null);
      setPhotoPreview(editing?.photo_path || "");
      return;
    }
    if (!editing) return;
    try {
      await api.deleteEmployeePhoto(editing.id);
      setPhotoPreview("");
      setEditing((e) => (e ? { ...e, photo_path: null } : e));
      await load();
      say("Profile photo removed");
    } catch (e) {
      setError(e.message || "Could not remove photo");
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Employee name is required");
    setSaving(true);
    setError("");
    try {
      let id = editing?.id;
      if (editing) await api.updateEmployee(editing.id, form);
      else {
        const created = await api.createEmployee(form);
        id = created.id;
      }
      if (photoFile && id) await api.uploadEmployeePhoto(id, photoFile);
      setFormOpen(false);
      await draft.clear();
      await load();
      say(editing ? "Employee updated" : "Employee added");
    } catch (err) {
      setError(err.message || "Could not save employee");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteEmployee(confirm.id);
      setConfirm(null);
      await load();
      say("Employee removed");
    } catch (e) {
      setError(e.message || "Could not remove employee");
      setConfirm(null);
    }
  };

  const amountField = PAY_MODES.find((m) => m.value === form.salary_type) || PAY_MODES[0];

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
              {totals.active} active · {employees.length} total · payslips for {fmtMonth(month)}
            </p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Add Employee
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Active staff</p>
          <p className="mt-1 text-xl font-bold text-indigo-700">{totals.active}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Earned this month</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{fmtMoney(totals.earned)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Still owed</p>
          <p className={`mt-1 text-xl font-bold ${totals.balance >= 0 ? "text-amber-600" : "text-rose-600"}`}>
            {fmtMoney(totals.balance)}
          </p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Documents</p>
          <p className="mt-1 text-xl font-bold text-sky-600">{totals.documents}</p>
        </Card>
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, role, phone or rank…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${SELECT} sm:w-48`}>
          <option value="">All employment statuses</option>
          {EMPLOYEE_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-400">Loading…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-600">No employees found</p>
          <p className="mt-1 text-xs text-slate-400">Add your first employee to start attendance and payroll.</p>
          <Button className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Employee
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((employee) => {
            const p = employee.payroll || {};
            const lf = p.lifetime || {};
            const isFreelancer = employee.salary_type === "freelancer";
            const status = EMPLOYEE_STATUS_META[employee.status] || EMPLOYEE_STATUS_META.active;
            return (
              <Card key={employee.id} className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {employee.photo_path ? (
                      <img
                        src={employee.photo_path}
                        alt={employee.name}
                        loading="lazy"
                        decoding="async"
                        className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white shadow"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600">
                        {initials(employee.name)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">{employee.name}</p>
                      <p className="truncate text-xs text-slate-400">
                        {employee.designation || "Employee"}
                        {employee.phone && <span> · {employee.phone}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => onNavigate?.("employeeDocuments")}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                      aria-label="Documents"
                      title="Documents"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => openEdit(employee)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() =>
                        setConfirm({
                          id: employee.id,
                          name: employee.name,
                          message: `Delete ${employee.name}? Their attendance, payments, payroll and documents go with them.`
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
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${status.color}`}>{status.label}</span>
                  <RankBadge rank={employee.rank} />
                  <Stars n={Number(employee.stars) || 0} />
                  {employee.shift_start && employee.shift_end && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                      <Clock className="h-3 w-3" /> {stripTime(employee.shift_start)}–
                      {stripTime(employee.shift_end)}
                    </span>
                  )}
                  {!!employee.pf_enabled && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700">
                      <PiggyBank className="h-3 w-3" /> PF {Number(employee.pf_rate) || 0}%
                    </span>
                  )}
                  {!!employee.documents && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                      <FileText className="h-3 w-3" /> {employee.documents}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {isFreelancer ? (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                      Freelancer · {fmtMoney(employee.salary_rate)}
                    </span>
                  ) : employee.salary_type === "wages" ? (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                      {fmtMoney(employee.salary_rate)}/day
                    </span>
                  ) : (
                    <>
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                        {fmtMoney(employee.salary_rate)}/month
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                        <TrendingUp className="h-3 w-3" /> {fmtMoney(p.daily)}/day
                      </span>
                    </>
                  )}
                  {employee.last_working_date && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                      Last day {fmtDate(employee.last_working_date)}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      {isFreelancer ? "Payments this month" : `Earned in ${fmtMonth(month)}`}
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
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add employee"}
            </Button>
          </>
        }
      >
        <DraftBanner draft={draft} />
        <form onSubmit={save} className="space-y-5">
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 p-3">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <ImageIcon className="h-7 w-7" />
              </div>
            )}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100">
              <Upload className="h-3.5 w-3.5" /> Profile photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  pickPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {photoPreview && (
              <button
                type="button"
                onClick={removePhoto}
                className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
              >
                <X className="h-3.5 w-3.5" /> Remove
              </button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Designation">
              <Input value={form.designation} onChange={(e) => set("designation", e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Employment status">
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className={SELECT}>
                {EMPLOYEE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Last working date" hint="Fill this when the employee leaves.">
              <Input
                type="date"
                value={form.last_working_date}
                onChange={(e) => set("last_working_date", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How is the employee paid?">
              <select value={form.salary_type} onChange={(e) => set("salary_type", e.target.value)} className={SELECT}>
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
                value={form.salary_rate}
                onChange={(e) => set("salary_rate", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rank">
              <select value={form.rank} onChange={(e) => set("rank", e.target.value)} className={SELECT}>
                {RANKS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Stars (${form.stars} of 5)`}>
              <div className="flex items-center gap-1 py-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => set("stars", i)}
                    aria-label={`${i} star${i > 1 ? "s" : ""}`}
                    className="rounded-lg p-0.5 transition hover:bg-amber-50"
                  >
                    <Star
                      className={`h-5 w-5 ${
                        i <= Number(form.stars) ? "fill-amber-400 text-amber-400" : "text-slate-200"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shift starts" hint="Clock times are reference only — they do not change pay.">
              <TimeInput
                value={form.shift_start}
                onChange={(v) => set("shift_start", v)}
                options={timeOptions("", "")}
                ariaLabel="Shift start time"
              />
            </Field>
            <Field label="Shift ends">
              <TimeInput
                value={form.shift_end}
                onChange={(v) => set("shift_end", v)}
                options={timeOptions(form.shift_start, "")}
                ariaLabel="Shift end time"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Joining date">
              <Input
                type="date"
                value={form.joining_date}
                onChange={(e) => set("joining_date", e.target.value)}
              />
            </Field>
            <Field label="Payroll starts" hint="Attendance before this date earns nothing.">
              <Input
                type="date"
                value={form.starting_date}
                onChange={(e) => set("starting_date", e.target.value)}
              />
            </Field>
            <Field label="Date of birth">
              <Input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => set("date_of_birth", e.target.value)}
              />
            </Field>
            <Field label="ID proof type">
              <Input
                value={form.id_proof_type}
                onChange={(e) => set("id_proof_type", e.target.value)}
                placeholder="Aadhaar, PAN, driving licence…"
              />
            </Field>
            <Field label="ID proof number">
              <Input
                value={form.id_proof_number}
                onChange={(e) => set("id_proof_number", e.target.value)}
              />
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={!!form.pf_enabled}
                onChange={(e) => set("pf_enabled", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="text-sm font-semibold text-slate-700">Provident fund</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  Employee share comes out of pay; the shop matches it. Both are a percentage of earned salary.
                </span>
              </span>
            </label>
            {form.pf_enabled && (
              <Field label="PF rate (%)" className="mt-3 max-w-[10rem]">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={form.pf_rate}
                  onChange={(e) => set("pf_rate", e.target.value)}
                />
              </Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank name">
              <Input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
            </Field>
            <Field label="Account number">
              <Input
                value={form.bank_account_no}
                onChange={(e) => set("bank_account_no", e.target.value)}
              />
            </Field>
            <Field label="IFSC">
              <Input
                value={form.bank_ifsc}
                onChange={(e) => set("bank_ifsc", e.target.value)}
                className="uppercase"
              />
            </Field>
            <Field label="UPI ID">
              <Input value={form.upi_id} onChange={(e) => set("upi_id", e.target.value)} />
            </Field>
            <Field label="Emergency contact name">
              <Input
                value={form.emergency_contact_name}
                onChange={(e) => set("emergency_contact_name", e.target.value)}
              />
            </Field>
            <Field label="Emergency contact phone">
              <Input
                type="tel"
                value={form.emergency_contact_phone}
                onChange={(e) => set("emergency_contact_phone", e.target.value)}
              />
            </Field>
          </div>

          <Field label="Address">
            <Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="Delete employee?"
        message={confirm?.message}
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
