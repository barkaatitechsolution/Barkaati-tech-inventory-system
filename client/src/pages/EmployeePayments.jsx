import { useEffect, useMemo, useState } from "react";
import { HandCoins, Plus, Search, Trash2, Lock } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import DraftBanner from "../components/DraftBanner.jsx";
import { Field, Input, Button } from "../components/Field.jsx";
import { fmtMoney, fmtDate } from "../lib/format.js";
import { useFormDraft, useDraftReopen } from "../lib/formDraft.js";
import {
  PAYMENT_METHODS,
  PAYMENT_OPTIONS,
  blankPayment,
  currentMonth,
  monthBounds
} from "../lib/employees.js";

const SELECT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

const PAYMENT_TYPE_META = {
  salary: { label: "Salary", color: "bg-sky-50 text-sky-700" },
  advance: { label: "Advance", color: "bg-amber-50 text-amber-700" },
  bonus: { label: "Bonus", color: "bg-emerald-50 text-emerald-700" },
  deduction: { label: "Deduction", color: "bg-rose-50 text-rose-700" }
};

export default function EmployeePayments() {
  const [month, setMonth] = useState(currentMonth);
  const [allTime, setAllTime] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [employees, setEmployees] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(blankPayment);
  const [formLocked, setFormLocked] = useState(false);
  const [checkingLock, setCheckingLock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const draft = useFormDraft({
    key: "employee-payments:new",
    value: { form },
    apply: (v) => {
      if (v.form) setForm(v.form);
    },
    active: addOpen
  });

  useDraftReopen({
    prefix: "employee-payments",
    open: addOpen,
    onReopen: () => setAddOpen(true)
  });

  const loadEmployees = async () => {
    try {
      const list = await api.employees();
      setEmployees(Array.isArray(list) ? list : []);
    } catch {
      /* the form still shows a clear message if there is nothing to pick */
    }
  };

  const loadPayments = async () => {
    setLoading(true);
    try {
      const params = {};
      if (employeeId) params.employee_id = employeeId;
      if (!allTime) {
        const { first, last } = monthBounds(month);
        params.from = first;
        params.to = last;
      }
      const list = await api.employeePayments(params);
      setPayments(Array.isArray(list) ? list : []);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load employee payments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, allTime, employeeId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!addOpen) return;
    const key = String(form.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) {
      setFormLocked(false);
      return;
    }
    let cancelled = false;
    setCheckingLock(true);
    api
      .employeePayroll(key)
      .then((payroll) => {
        if (!cancelled) setFormLocked(!!payroll?.locked);
      })
      .catch(() => {
        if (!cancelled) setFormLocked(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingLock(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addOpen, form.date]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((payment) => {
      if (typeFilter && payment.type !== typeFilter) return false;
      if (!q) return true;
      return [payment.employee_name, payment.note, payment.payment_method]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [payments, search, typeFilter]);

  const totals = useMemo(() => {
    const out = { count: filtered.length, total: 0, salary: 0, advance: 0, bonus: 0, deduction: 0 };
    for (const payment of filtered) {
      const amount = Number(payment.amount) || 0;
      out.total += amount;
      if (out[payment.type] != null) out[payment.type] += amount;
    }
    return out;
  }, [filtered]);

  const openAdd = () => {
    setForm({ ...blankPayment(), employee_id: employeeId || employees[0]?.id || "" });
    setAddOpen(true);
    setError("");
  };

  const save = async () => {
    if (!form.employee_id) {
      setError("Choose an employee first");
      return;
    }
    if (!Number(form.amount) || Number(form.amount) <= 0) {
      setError("Enter an amount greater than zero");
      return;
    }
    setSaving(true);
    try {
      await api.createEmployeePayment(form.employee_id, {
        type: form.type,
        amount: Number(form.amount),
        payment_method: form.payment_method,
        date: form.date,
        note: form.note.trim() || null
      });
      setAddOpen(false);
      await draft.clear();
      setToast("Payment recorded");
      await loadPayments();
    } catch (e) {
      setError(e.message || "Could not record payment");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteEmployeePayment(deleteTarget.id);
      setDeleteTarget(null);
      setToast("Payment deleted");
      await loadPayments();
    } catch (e) {
      setError(e.message || "Could not delete payment");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <HandCoins className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Employee payments</p>
            <p className="text-xs text-slate-500">
              Advances, salary payouts, bonuses and deductions reduce the outstanding balance.
            </p>
          </div>
        </div>
        <Button onClick={openAdd} disabled={employees.length === 0}>
          <Plus className="h-4 w-4" /> Record payment
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PAYMENT_OPTIONS.map((option) => (
          <Card key={option.value} className="!p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{option.label}</p>
            <p className="mt-1 text-lg font-bold text-slate-800">{fmtMoney(totals[option.value])}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month">
          <Input
            type="month"
            value={month}
            onChange={(e) => {
              setAllTime(false);
              setMonth(e.target.value);
            }}
            className="w-40"
            disabled={allTime}
          />
        </Field>
        <Button variant={allTime ? "primary" : "ghost"} onClick={() => setAllTime((v) => !v)}>
          All time
        </Button>
        <Field label="Employee">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={`${SELECT} w-48`}
          >
            <option value="">All employees</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`${SELECT} w-40`}>
            <option value="">All types</option>
            {PAYMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="relative flex-1 sm:min-w-48 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee or note…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <span className="ml-auto text-xs text-slate-500">
          {totals.count} payments · <span className="font-semibold text-slate-700">{fmtMoney(totals.total)}</span>
        </span>
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

      <Card className="!p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <HandCoins className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No employee payments found</p>
            <p className="mt-1 text-sm text-slate-500">
              {payments.length === 0 ? "Record the first payment to start the ledger." : "Try a different filter."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-3 py-3">Employee</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3">Note</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Delete</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((payment) => {
                  const meta = PAYMENT_TYPE_META[payment.type] || PAYMENT_TYPE_META.salary;
                  return (
                    <tr key={payment.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(payment.date)}</td>
                      <td className="px-3 py-3 font-semibold text-slate-800">{payment.employee_name}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${meta.color}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs capitalize text-slate-500">
                        {payment.payment_method || "cash"}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-3 text-xs text-slate-500">
                        {payment.note || "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-slate-800">
                        {fmtMoney(payment.amount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setDeleteTarget(payment)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          title="Delete payment"
                          aria-label="Delete payment"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Record employee payment"
        subtitle="Every payment type reduces what the shop owes this employee."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || formLocked || checkingLock}>
              {saving ? "Saving…" : "Record payment"}
            </Button>
          </>
        }
      >
        <DraftBanner draft={draft} />
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee" required>
              <select
                value={form.employee_id || ""}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                className={SELECT}
              >
                <option value="">Select employee…</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                    {employee.status !== "active" ? ` (${employee.status})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type" required>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className={SELECT}
              >
                {PAYMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" required>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0"
              />
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </Field>
            <Field label="Paid by">
              <select
                value={form.payment_method}
                onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                className={SELECT}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note">
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Optional"
              />
            </Field>
          </div>

          {formLocked && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              That month's payroll is finalized, so payments cannot be added. Reopen the month from Payroll
              first.
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            Salary, advance, bonus and deduction all reduce the employee's balance. Deductions are recorded as
            payments for ledger compatibility.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete this payment?"
        subtitle={
          deleteTarget
            ? `${deleteTarget.employee_name} · ${fmtMoney(deleteTarget.amount)} · ${fmtDate(deleteTarget.date)}`
            : ""
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete payment"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          The payment will be removed from the employee's ledger. Finalized months cannot be changed.
        </p>
      </Modal>
    </div>
  );
}
