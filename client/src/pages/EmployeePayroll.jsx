import { useEffect, useMemo, useState } from "react";
import {
  Wallet,
  Lock,
  Unlock,
  Search,
  FileText,
  ReceiptText,
  MessageCircle,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";
import { api } from "../api.js";
import { useStoreInfo } from "../lib/storeInfo.js";
import { sendWhatsApp } from "../lib/whatsapp.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import DraftBanner from "../components/DraftBanner.jsx";
import { Field, Input, Button } from "../components/Field.jsx";
import { fmtMoney, fmtDate, fmtMonth } from "../lib/format.js";
import { printPayslip } from "../lib/employeePrint.js";
import { useFormDraft } from "../lib/formDraft.js";
import {
  PAYMENT_METHODS,
  PAYROLL_STATUS_META,
  STATUS_META,
  currentMonth
} from "../lib/employees.js";
import { workedHours, fmtHours } from "../lib/hours.js";

const SELECT =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export default function EmployeePayroll() {
  const store = useStoreInfo();
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState({ month: currentMonth(), locked: false, has_paid: false, rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [ledgerFor, setLedgerFor] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [payMethod, setPayMethod] = useState("cash");
  const [payNote, setPayNote] = useState("");
  const [saving, setSaving] = useState(false);

  const payDraft = useFormDraft({
    key: `employee-payroll:pay:${month}:${payFor?.id ?? "none"}`,
    value: { payFor, payMethod, payNote },
    apply: (v) => {
      if (v.payFor) setPayFor(v.payFor);
      if (v.payMethod) setPayMethod(v.payMethod);
      if (v.payNote !== undefined) setPayNote(v.payNote);
    },
    active: !!payFor
  });

  const load = async (m = month) => {
    setLoading(true);
    try {
      const result = await api.employeePayroll(m);
      setData(result || { month: m, locked: false, has_paid: false, rows: [] });
      setError("");
    } catch (e) {
      setError(e.message || "Could not load payroll");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const rows = Array.isArray(data.rows) ? data.rows : [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !q ||
        [row.name, row.designation, row.phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      const matchesStatus = !statusFilter || row.payroll_status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => {
    const t = { employees: rows.length, earned: 0, pf: 0, paid: 0, net: 0 };
    for (const row of rows) {
      t.earned += Number(row.accrual) || 0;
      t.pf += Number(row.pf_employee) || 0;
      t.paid += Number(row.paid_before) || 0;
      t.net += Number(row.net_payable) || 0;
    }
    return t;
  }, [rows]);

  const openLedger = async (row) => {
    setLedgerFor(row);
    setLedger(null);
    setLedgerLoading(true);
    try {
      const result = await api.employeeLedger(row.id, month);
      setLedger(result);
    } catch (e) {
      setError(e.message || "Could not load ledger");
    } finally {
      setLedgerLoading(false);
    }
  };

  const finalize = async () => {
    setSaving(true);
    try {
      const res = await api.finalizeEmployeePayroll(month);
      setFinalizeOpen(false);
      setToast(`Payroll finalized for ${res.finalized} employee${res.finalized === 1 ? "" : "s"}`);
      await load(month);
    } catch (e) {
      setError(e.message || "Could not finalize payroll");
      setFinalizeOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const reopen = async () => {
    setSaving(true);
    try {
      await api.reopenEmployeePayroll(month);
      setReopenOpen(false);
      setToast("Payroll month reopened");
      await load(month);
    } catch (e) {
      setError(e.message || "Could not reopen payroll");
      setReopenOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async () => {
    if (!payFor) return;
    setSaving(true);
    try {
      const res = await api.payEmployeePayroll(payFor.id, {
        month,
        payment_method: payMethod,
        note: payNote.trim() || null
      });
      setPayFor(null);
      setPayNote("");
      await payDraft.clear();
      setToast(
        res.amount > 0
          ? `${payFor.name} marked paid · ${fmtMoney(res.amount)} recorded`
          : `${payFor.name} settled — no amount was outstanding`
      );
      await load(month);
    } catch (e) {
      setError(e.message || "Could not mark payslip paid");
      setPayFor(null);
    } finally {
      setSaving(false);
    }
  };

  const printFor = (row) => printPayslip(store, row, row, month);

  const whatsappFor = (row) => {
    const lines = [
      `*${store.name || "Store"}*`,
      `Payslip · ${fmtMonth(month)}`,
      `Employee: ${row.name}`,
      `Earned: ${fmtMoney(row.accrual)}`,
      `Provident fund: ${fmtMoney(row.pf_employee)}`,
      `Payments already recorded: ${fmtMoney(row.paid_before)}`,
      `Net payable: ${fmtMoney(row.net_payable)}`,
      row.payroll_status === "paid"
        ? `Status: Paid${row.paid_at ? ` on ${fmtDate(row.paid_at)}` : ""}`
        : "Status: Pending"
    ];
    if (row.pf_employer) lines.push(`Employer PF: ${fmtMoney(row.pf_employer)}`);
    sendWhatsApp(lines.join("\n"), row.phone);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Payroll</p>
            <p className="text-xs text-slate-500">
              Draft from attendance, finalize the month, then mark each payslip paid.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
          {data.locked ? (
            <>
              {!data.has_paid && (
                <>
                  <Button variant="soft" onClick={() => setFinalizeOpen(true)}>
                    <Lock className="h-4 w-4" /> Recalculate
                  </Button>
                  <Button variant="ghost" onClick={() => setReopenOpen(true)}>
                    <Unlock className="h-4 w-4" /> Reopen
                  </Button>
                </>
              )}
            </>
          ) : (
            <Button onClick={() => setFinalizeOpen(true)} disabled={loading || rows.length === 0}>
              <Lock className="h-4 w-4" /> Finalize month
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Employees</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{totals.employees}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Earned</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{fmtMoney(totals.earned)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">PF (employee)</p>
          <p className="mt-1 text-xl font-bold text-violet-600">{fmtMoney(totals.pf)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Paid before</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{fmtMoney(totals.paid)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Net payable</p>
          <p className={`mt-1 text-xl font-bold ${totals.net >= 0 ? "text-indigo-700" : "text-rose-600"}`}>
            {fmtMoney(totals.net)}
          </p>
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
      {data.locked && (
        <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {fmtMonth(month)} is finalized. Attendance and payments for this month are locked until the month is
            reopened.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${SELECT} sm:w-44`}>
          <option value="">All payroll statuses</option>
          <option value="draft">Draft</option>
          <option value="finalized">Finalized</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      <Card className="!p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
              <Wallet className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No payroll rows found</p>
            <p className="mt-1 text-sm text-slate-500">
              {rows.length === 0 ? "Add employees and mark attendance first." : "Try a different filter."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-3 py-3 text-right">Paid days</th>
                  <th className="px-3 py-3 text-right">Earned</th>
                  <th className="px-3 py-3 text-right">PF</th>
                  <th className="px-3 py-3 text-right">Paid before</th>
                  <th className="px-3 py-3 text-right">Net payable</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const meta = PAYROLL_STATUS_META[row.payroll_status] || PAYROLL_STATUS_META.draft;
                  return (
                    <tr key={row.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">{row.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {row.designation || "Employee"}
                          {row.phone ? ` · ${row.phone}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {row.paid_days % 1 === 0 ? row.paid_days : Number(row.paid_days).toFixed(1)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-700">
                        {fmtMoney(row.accrual)}
                      </td>
                      <td className="px-3 py-3 text-right text-violet-700">{fmtMoney(row.pf_employee)}</td>
                      <td className="px-3 py-3 text-right text-amber-700">{fmtMoney(row.paid_before)}</td>
                      <td
                        className={`px-3 py-3 text-right font-bold ${
                          Number(row.net_payable) >= 0 ? "text-slate-800" : "text-rose-600"
                        }`}
                      >
                        {fmtMoney(row.net_payable)}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${meta.color}`}>
                          {meta.label}
                        </span>
                        {row.payroll_status === "paid" && row.paid_at && (
                          <p className="mt-1 text-[10px] text-slate-400">{fmtDate(row.paid_at)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openLedger(row)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            title="View ledger"
                            aria-label="View ledger"
                          >
                            <ReceiptText className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => printFor(row)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                            title="Print payslip"
                            aria-label="Print payslip"
                          >
                            <FileText className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => whatsappFor(row)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                            title="Send on WhatsApp"
                            aria-label="Send on WhatsApp"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>
                          {row.payroll_status === "finalized" && (
                            <button
                              onClick={() => {
                                setPayFor(row);
                                setPayMethod("cash");
                                setPayNote("");
                              }}
                              className="ml-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                            >
                              Mark paid
                            </button>
                          )}
                        </div>
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
        open={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        title={data.locked ? "Recalculate finalized payroll?" : "Finalize payroll month?"}
        subtitle={fmtMonth(month)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFinalizeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={finalize} disabled={saving}>
              {saving ? "Finalizing…" : data.locked ? "Recalculate" : "Finalize month"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Finalizing snapshots every employee's earned salary, PF and net payable for {fmtMonth(month)}.
            Attendance and payments for this month become locked.
          </p>
          <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
            Only reopen this month if you need to correct attendance or payments. Paid payslips are never changed.
          </div>
        </div>
      </Modal>

      <Modal
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        title="Reopen payroll month?"
        subtitle={`${fmtMonth(month)} becomes editable again`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReopenOpen(false)}>
              Cancel
            </Button>
            <Button onClick={reopen} disabled={saving}>
              {saving ? "Reopening…" : "Reopen month"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          The finalized salary snapshots for {fmtMonth(month)} will be deleted. No payslips have been marked paid,
          so no recorded payments will be affected.
        </p>
      </Modal>

      <Modal
        open={!!payFor}
        onClose={() => setPayFor(null)}
        title={payFor ? `Mark ${payFor.name} paid` : "Mark paid"}
        subtitle={payFor ? `${fmtMonth(month)} · net ${fmtMoney(payFor.net_payable)}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayFor(null)}>
              Cancel
            </Button>
            <Button onClick={markPaid} disabled={saving || Number(payFor?.net_payable) < 0}>
              {saving ? "Saving…" : "Mark paid"}
            </Button>
          </>
        }
      >
        <DraftBanner draft={payDraft} />
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid by">
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={SELECT}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount">
              <Input value={fmtMoney(payFor?.net_payable)} readOnly />
            </Field>
          </div>
          <Field label="Note">
            <Input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Optional" />
          </Field>
          {Number(payFor?.net_payable) < 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This employee has already been paid more than this month's earnings. Adjust the payments or reopen
              the month first.
            </p>
          )}
          <p className="text-[11px] text-slate-400">
            Marking paid records a salary payment dated the last day of {fmtMonth(month)}.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!ledgerFor}
        onClose={() => setLedgerFor(null)}
        wide
        title={ledgerFor ? `${ledgerFor.name} · ${fmtMonth(month)}` : "Ledger"}
        subtitle="Every marked day, payment and PF deduction, in order."
        footer={
          <Button variant="ghost" onClick={() => setLedgerFor(null)}>
            Done
          </Button>
        }
      >
        {ledgerLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : !ledger?.events?.length ? (
          <p className="py-8 text-center text-sm text-slate-400">Nothing recorded for this month.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-emerald-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-emerald-600">Earned</p>
                <p className="text-lg font-bold text-emerald-700">{fmtMoney(ledger.accrual)}</p>
              </div>
              <div className="rounded-xl bg-violet-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-violet-600">PF (employee)</p>
                <p className="text-lg font-bold text-violet-700">{fmtMoney(ledger.pf?.employee)}</p>
              </div>
              <div className="rounded-xl bg-slate-100 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-slate-500">Balance</p>
                <p className="text-lg font-bold text-slate-800">{fmtMoney(ledger.balance)}</p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Detail</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">Running</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.events.map((event, index) => {
                    const hours =
                      event.kind === "attendance" ? workedHours(event.time_in, event.time_out) : null;
                    return (
                      <tr key={index} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {event.date ? fmtDate(event.date) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {event.kind === "attendance" ? (
                            <span className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                  STATUS_META[event.status]?.color || "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {STATUS_META[event.status]?.label || event.status}
                              </span>
                              {hours !== null && (
                                <span className="text-[11px] tabular-nums text-slate-400">
                                  {fmtHours(hours)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">{event.label}</span>
                          )}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-semibold ${
                            event.amount >= 0 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {event.amount >= 0 ? "+" : ""}
                          {fmtMoney(event.amount)}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-slate-700">
                          {fmtMoney(event.running)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <p className="text-[11px] text-slate-400">
        Finalizing snapshots the month. Paid payslips add a salary payment record so the ledger closes to zero.
      </p>
    </div>
  );
}
