import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, Wallet } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import {
  Badge,
  Button,
  Card,
  Confirm,
  Empty,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  showToast
} from "../components/ui.jsx";

const blank = () => ({
  customer_id: "",
  sale_id: "",
  amount: "",
  method: "cash",
  paid_on: new Date().toISOString().slice(0, 10),
  note: ""
});

export default function CustomerPayments() {
  const { version, bump } = useApp();
  const payments = useAsync(() => api.customerPayments(), [version]);
  const customers = useAsync(() => api.customers(), [version]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [bills, setBills] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (open) setForm(blank());
  }, [open]);

  useEffect(() => {
    if (!form.customer_id) {
      setBills([]);
      return;
    }
    api.customerBills(form.customer_id).then(setBills).catch(() => setBills([]));
  }, [form.customer_id]);

  const rows = payments.data || [];
  const customerRows = customers.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => [p.customer_name, p.invoice_no, p.method, p.note].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const total = rows.reduce((n, p) => n + (Number(p.amount) || 0), 0);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.customer_id) return showToast("Choose a customer", "error");
    if (!(Number(form.amount) > 0)) return showToast("Enter an amount", "error");
    setSaving(true);
    try {
      await api.createCustomerPayment({
        ...form,
        customer_id: Number(form.customer_id),
        sale_id: form.sale_id ? Number(form.sale_id) : null,
        amount: Number(form.amount) || 0
      });
      showToast("Payment recorded");
      setOpen(false);
      bump();
      payments.reload();
    } catch (e) {
      showToast(e?.message || "Could not record payment", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteCustomerPayment(deleting.id);
      showToast("Payment removed");
      setDeleting(null);
      bump();
      payments.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Customer payments" subtitle={`${rows.length} payments · ${fmtMoney(total)} received`}
        right={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record</Button>} />

      <div className="space-y-3 px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payments" />
        </div>

        {payments.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : payments.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{payments.error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((p) => (
              <Card key={p.id} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Wallet className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.customer_name || "Customer"}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {fmtDate(p.paid_on || p.created_at)} · {p.method || "cash"}{p.invoice_no ? ` · ${p.invoice_no}` : ""}
                  </p>
                  {p.note ? <p className="truncate text-[10px] text-slate-400">{p.note}</p> : null}
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-emerald-600">{fmtMoney(p.amount)}</p>
                  <Badge tone="green">received</Badge>
                </div>
                <IconButton onClick={() => setDeleting(p)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={Wallet} title="No payments" description="Record customer payments against their bills."
            action={<Button onClick={() => setOpen(true)}>Record payment</Button>} />
        )}
      </div>

      <Modal open={open} title="Record customer payment" onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save payment</Button>}>
        <div className="space-y-3">
          <Field label="Customer">
            <Select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value, sale_id: "" }))}>
              <option value="">Choose a customer</option>
              {customerRows.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Bill (optional)" hint={form.customer_id ? undefined : "Choose a customer to see unpaid bills"}>
            <Select value={form.sale_id} onChange={set("sale_id")} disabled={!form.customer_id}>
              <option value="">General payment (no bill)</option>
              {bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.invoice_no} · due {fmtMoney(Number(b.total) - Number(b.paid))}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount (Rs)"><Input value={form.amount} onChange={set("amount")} inputMode="decimal" /></Field>
            <Field label="Date"><Input type="date" value={form.paid_on} onChange={set("paid_on")} /></Field>
          </div>
          <Field label="Method">
            <Select value={form.method} onChange={set("method")}>
              {["cash", "upi", "card", "bank", "cheque"].map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Note"><Textarea value={form.note} onChange={set("note")} rows={2} /></Field>
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Delete payment?" message="The bill balance will be restored if this payment was linked to a bill."
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}
