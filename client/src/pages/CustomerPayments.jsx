import { useEffect, useMemo, useState } from "react";
import {
  HandCoins,
  Search,
  RefreshCw,
  Phone,
  Undo2,
  Wallet,
  CheckCircle2,
  ReceiptIndianRupee
} from "lucide-react";
import { api } from "../api";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import Modal from "../components/Modal.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import { fmtDate, fmtDateTime, fmtMoney } from "../lib/format";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "online", label: "UPI / Online" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" }
];

const METHOD_LABEL = METHODS.reduce((m, r) => ({ ...m, [r.value]: r.label }), {});

const todayInput = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const money = (n) => fmtMoney(n);

export default function CustomerPayments({ action, onActionConsumed }) {
  const [customers, setCustomers] = useState([]);
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [paying, setPaying] = useState(null);
  const [undoing, setUndoing] = useState(null);
  const [payRegisterSearch, setPayRegisterSearch] = useState("");
  const [payRegisterSort, setPayRegisterSort] = useState("newest");

  const load = async (customerId) => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        api.customers(),
        api.customerPayments({ limit: 100 })
      ]);
      setCustomers(c || []);
      setPayments(p || []);
      setError(null);
      if (customerId) {
        setBills(await api.customerBills(customerId));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Opened from the Customers page with a customer already picked.
  useEffect(() => {
    if (action?.type !== "payment" || !action.customer_id) return;
    const id = String(action.customer_id);
    setSelectedId(id);
    load(id);
    if (onActionConsumed) onActionConsumed();
  }, [action]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const dues = useMemo(
    () => customers.filter((c) => (Number(c.balance) || 0) > 0),
    [customers]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dues;
    return dues.filter((c) =>
      [c.name, c.phone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [dues, search]);

  const selected = customers.find((c) => String(c.id) === String(selectedId)) || null;

  const stats = useMemo(() => {
    const outstanding = dues.reduce((s, c) => s + (Number(c.balance) || 0), 0);
    const collected = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const month = new Date().toISOString().slice(0, 7);
    const collectedThisMonth = payments
      .filter((p) => String(p.paid_on || "").slice(0, 7) === month)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return { outstanding, collected, collectedThisMonth, count: payments.length };
  }, [dues, payments]);

  const scopedPayments = useMemo(
    () => (selectedId ? payments.filter((p) => String(p.customer_id ?? "") === String(selectedId)) : payments),
    [payments, selectedId]
  );

  const filteredPayments = useMemo(() => {
    const q = payRegisterSearch.trim().toLowerCase();
    let list = [...scopedPayments];
    if (q) {
      list = list.filter((p) =>
        [p.invoice_no, p.customer_name, p.customer, p.customer_phone, p.note, METHOD_LABEL[p.method] || p.method]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    const paidAt = (p) => new Date(p.paid_on || p.created_at || 0).getTime();
    if (payRegisterSort === "oldest") {
      list.sort((a, b) => paidAt(a) - paidAt(b));
    } else if (payRegisterSort === "amount_high") {
      list.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
    } else if (payRegisterSort === "amount_low") {
      list.sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
    } else if (payRegisterSort === "name") {
      list.sort((a, b) => {
        const na = String(a.customer_name || a.customer || "").toLowerCase();
        const nb = String(b.customer_name || b.customer || "").toLowerCase();
        if (na < nb) return -1;
        if (na > nb) return 1;
        return 0;
      });
    } else {
      list.sort((a, b) => paidAt(b) - paidAt(a));
    }
    return list;
  }, [scopedPayments, payRegisterSearch, payRegisterSort]);

  const selectCustomer = async (id) => {
    setSelectedId(id);
    setError(null);
    try {
      const pb = await api.customerBills(id);
      setBills(pb || []);
    } catch (e) {
      setError(e.message);
      setBills([]);
    }
  };

  const afterChange = async (message) => {
    setPaying(null);
    setToast(message);
    await load(selectedId);
    if (selectedId) {
      try {
        setBills((await api.customerBills(selectedId)) || []);
      } catch {
        // ignore
      }
    }
  };

  const undo = async () => {
    if (!undoing) return;
    try {
      await api.deleteCustomerPayment(undoing.id);
      setUndoing(null);
      setToast("Payment entry reversed");
      await load(selectedId);
      if (selectedId) {
        try {
          setBills((await api.customerBills(selectedId)) || []);
        } catch {
          // ignore
        }
      }
    } catch (e) {
      setError(e.message);
      setUndoing(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="Outstanding"
          value={money(stats.outstanding)}
          sub={`${dues.length} customer(s) owe money`}
          tone="rose"
        />
        <StatCard
          icon={HandCoins}
          label="Collected this month"
          value={money(stats.collectedThisMonth)}
          sub="part payments received"
          tone="emerald"
        />
        <StatCard
          icon={ReceiptIndianRupee}
          label="Payments recorded"
          value={stats.count}
          sub="in the register"
          tone="indigo"
        />
        <StatCard
          icon={CheckCircle2}
          label="Total received"
          value={money(stats.collected)}
          sub="all part payments"
          tone="violet"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px,1fr]">
        {/* Customers with dues */}
        <Card className="!p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Customers with dues</h3>
            <button
              onClick={() => load(selectedId)}
              disabled={loading}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="mt-3 max-h-[26rem] space-y-1 overflow-y-auto scrollbar-thin">
            {loading ? (
              <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                {dues.length === 0 ? "Every bill is settled" : "No matching customer"}
              </p>
            ) : (
              filtered.map((c) => {
                const active = String(c.id) === String(selectedId);
                return (
                  <button
                    key={c.id}
                    onClick={() => selectCustomer(c.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                      active ? "bg-indigo-50 ring-1 ring-indigo-100" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">{c.name}</span>
                      {c.phone && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Phone className="h-3 w-3" /> {c.phone}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-bold text-rose-600">
                      {money(c.balance)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Bills of the selected customer */}
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  {selected ? `Pending bills — ${selected.name}` : "Pending bills"}
                </h3>
                <p className="text-xs text-slate-400">
                  {selected
                    ? "Pick a bill to record a part payment against it."
                    : "Choose a customer on the left to see the bills they still owe."}
                </p>
              </div>
              {selected && (
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Total due</p>
                  <p className="text-xl font-bold text-rose-600">{money(selected.balance)}</p>
                </div>
              )}
            </div>

            <div className="mt-3 divide-y divide-slate-100">
              {!selected ? (
                <p className="py-8 text-center text-sm text-slate-400">No customer selected</p>
              ) : loading ? (
                <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
              ) : bills.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  {selected.name} has no unpaid bills
                </p>
              ) : (
                bills.map((b) => {
                  const due = round2(b.due);
                  return (
                    <div
                      key={b.id}
                      className="flex flex-wrap items-center gap-3 py-3"
                    >
                      <div className="min-w-0 flex-1 basis-48">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold tracking-wide text-slate-600">
                            {b.invoice_no}
                          </span>
                          <span className="text-[11px] text-slate-400">{fmtDate(b.created_at)}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Bill {money(b.total)} · paid {money(b.paid)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-rose-600">{money(due)}</p>
                        <p className="text-[11px] text-slate-400">due</p>
                      </div>
                      <Button variant="soft" className="!px-3 !py-2 text-xs" onClick={() => setPaying(b)}>
                        <HandCoins className="h-3.5 w-3.5" />
                        Record payment
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* Payment register */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Payment register</h3>
                <p className="text-xs text-slate-400">
                  Part payments for bills still outstanding. Fully settled bills move to Completed bills.
                </p>
              </div>
              <button
                onClick={() => load(selectedId)}
                disabled={loading}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={payRegisterSearch}
                  onChange={(e) => setPayRegisterSearch(e.target.value)}
                  placeholder="Search by name, invoice, method, note..."
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <select
                value={payRegisterSort}
                onChange={(e) => setPayRegisterSort(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">By customer name</option>
                <option value="amount_high">Amount (high to low)</option>
                <option value="amount_low">Amount (low to high)</option>
              </select>
            </div>

            <div className="mt-3 divide-y divide-slate-100">
              {loading ? (
                <p className="px-1 py-8 text-center text-sm text-slate-400">Loading…</p>
              ) : scopedPayments.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <HandCoins className="h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-400">No payments recorded yet</p>
                </div>
              ) : filteredPayments.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-slate-400">No matching payments</p>
              ) : (
                filteredPayments.map((p) => (
                  <div key={p.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold tracking-wide text-slate-600">
                        {p.invoice_no || "—"}
                      </span>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                        {p.customer_name || p.customer || "Walk-in"}
                      </p>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        {METHOD_LABEL[p.method] || p.method}
                      </span>
                      <p className="text-sm font-bold text-emerald-600">+{money(p.amount)}</p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-400">
                        {p.paid_on ? fmtDate(p.paid_on) : fmtDateTime(p.created_at)}
                      </span>
                      {p.note && <span className="text-[11px] italic text-slate-400">"{p.note}"</span>}
                      <button
                        onClick={() => setUndoing(p)}
                        className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Undo2 className="h-3 w-3" />
                        Reverse
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

        </div>
      </div>

      <PaymentModal
        bill={paying}
        onClose={() => setPaying(null)}
        onSaved={afterChange}
      />

      <Modal
        open={!!undoing}
        onClose={() => setUndoing(null)}
        title="Reverse this payment?"
        subtitle={undoing?.invoice_no || ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setUndoing(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={undo}>
              Reverse payment
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {undoing
            ? `${money(undoing.amount)} received from ${
                undoing.customer_name || undoing.customer || "this customer"
              } will be taken off the bill and the entry removed from the register.`
            : ""}
        </p>
      </Modal>

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function PaymentModal({ bill, onClose, onSaved }) {
  const due = round2(bill?.due);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [paidOn, setPaidOn] = useState(todayInput());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Reset the form each time a different bill is opened.
  useEffect(() => {
    if (!bill) return;
    setAmount(String(due));
    setMethod("cash");
    setPaidOn(todayInput());
    setNote("");
    setErr(null);
  }, [bill, due]);

  if (!bill) return null;

  const value = round2(amount);
  const remaining = round2(due - value);

  const submit = async () => {
    if (!(value > 0)) {
      setErr("Enter the amount received");
      return;
    }
    if (value > due) {
      setErr(`Only ${money(due)} is still due on this bill`);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api.createCustomerPayment({
        sale_id: bill.id,
        amount: value,
        method,
        paid_on: paidOn || null,
        note: note.trim() || null
      });
      onSaved(`Payment of ${money(value)} recorded`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record customer payment"
      subtitle={`${bill.invoice_no} · ${bill.customer || "Walk-in"}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : `Record ${money(value)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] text-slate-400">Bill total</p>
            <p className="font-bold text-slate-800">{money(bill.total)}</p>
          </div>
          <div className="rounded-xl bg-rose-50 p-3">
            <p className="text-[11px] text-rose-500">Still due</p>
            <p className="font-bold text-rose-700">{money(due)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-[11px] text-emerald-500">Left after</p>
            <p className="font-bold text-emerald-700">{money(Math.max(0, remaining))}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="soft" className="flex-1 !px-2 text-xs" onClick={() => setAmount(String(due))}>
            Full due
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="flex-1 !px-2 text-xs"
            onClick={() => setAmount(String(round2(due / 2)))}
          >
            Half
          </Button>
          <Button type="button" variant="ghost" className="flex-1 !px-2 text-xs" onClick={() => setAmount("")}>
            Clear
          </Button>
        </div>

        <Field label="Amount received" required>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment method">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Paid on">
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
        </div>

        <Field label="Note (optional)">
          <Textarea
            rows={2}
            placeholder="Cash handed over at the counter…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {err && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}
