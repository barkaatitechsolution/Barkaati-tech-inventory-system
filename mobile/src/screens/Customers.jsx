import { useEffect, useState } from "react";
import { Barcode, CircleDollarSign, Pencil, Plus, Search, Trash2, User, Users } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney, initials } from "../lib/format.js";
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

const blank = { name: "", phone: "", email: "", address: "", credit_limit: "", category_id: "", notes: "" };

function CustomerForm({ open, customer, categories, onClose, onSaved }) {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(customer ? { ...blank, ...customer, category_id: customer.category_id || "" } : blank);
    setError("");
  }, [open, customer]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) {
      setError("Customer name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, credit_limit: Number(form.credit_limit) || 0, category_id: form.category_id || null };
      if (customer) await api.updateCustomer(customer.id, payload);
      else await api.createCustomer(payload);
      showToast(customer ? "Customer updated" : "Customer added");
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e?.message || "Could not save customer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={customer ? "Edit customer" : "New customer"}
      onClose={onClose}
      footer={
        <Button className="w-full" size="lg" loading={saving} onClick={save}>
          {customer ? "Save changes" : "Add customer"}
        </Button>
      }
    >
      <div className="space-y-3">
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <Field label="Name">
          <Input value={form.name} onChange={set("name")} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} inputMode="tel" />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={set("email")} inputMode="email" />
          </Field>
        </div>
        <Field label="Address">
          <Textarea value={form.address} onChange={set("address")} rows={2} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Credit limit (Rs)">
            <Input value={form.credit_limit} onChange={set("credit_limit")} inputMode="decimal" />
          </Field>
          <Field label="Category">
            <Select value={form.category_id} onChange={set("category_id")}>
              <option value="">None</option>
              {(categories || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={set("notes")} rows={2} />
        </Field>
        {customer?.barcode ? (
          <Field label="Card barcode">
            <Input value={customer.barcode} disabled />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function CustomerDetail({ customer, open, onClose, onChanged }) {
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [saleId, setSaleId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!customer) return;
    setLoading(true);
    try {
      const [b, p] = await Promise.all([
        api.customerBills(customer.id),
        api.customerPayments({ customer_id: customer.id })
      ]);
      setBills(b);
      setPayments(p);
    } catch (e) {
      showToast(e?.message || "Could not load customer", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && customer) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id]);

  const savePayment = async () => {
    if (!(Number(amount) > 0)) {
      showToast("Enter an amount", "error");
      return;
    }
    setBusy(true);
    try {
      await api.createCustomerPayment({
        customer_id: customer.id,
        amount: Number(amount),
        method,
        note,
        sale_id: saleId || null
      });
      showToast("Payment recorded");
      setPayOpen(false);
      setAmount("");
      setSaleId("");
      setNote("");
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e?.message || "Could not save payment", "error");
    } finally {
      setBusy(false);
    }
  };

  const balance = bills.reduce((n, b) => n + (Number(b.total) - Number(b.paid)), 0);

  return (
    <>
      <Modal
        open={open}
        title={customer?.name || "Customer"}
        onClose={onClose}
        wide
        footer={
          <Button className="w-full" onClick={() => { setPayOpen(true); setAmount(String(Math.max(0, Math.round(balance)))); }}>
            <CircleDollarSign className="h-4 w-4" /> Record payment
          </Button>
        }
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-brand-600" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Outstanding</p>
              <p className="text-2xl font-bold text-slate-900">{fmtMoney(balance)}</p>
              <p className="text-xs text-slate-400">{customer?.phone || "No phone"}</p>
              {customer?.barcode ? (
                <p className="mt-2 flex items-center gap-1 font-mono text-xs font-semibold text-slate-700">
                  <Barcode className="h-3.5 w-3.5" /> {customer.barcode}
                </p>
              ) : null}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Open bills</p>
              {bills.length ? (
                <div className="space-y-1.5">
                  {bills.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-700">{b.invoice_no}</p>
                        <p className="text-[11px] text-slate-400">{fmtDate(b.created_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-800">
                          {fmtMoney(Number(b.total) - Number(b.paid))}
                        </p>
                        <Badge tone="amber">due</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No open bills.</p>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Payments</p>
              {payments.length ? (
                <div className="space-y-1.5">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-700">{fmtDate(p.paid_on)}</p>
                        <p className="text-[11px] text-slate-400">
                          {String(p.method || "").toUpperCase()}
                          {p.invoice_no ? ` · ${p.invoice_no}` : ""}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-emerald-700">{fmtMoney(p.amount)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No payments yet.</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={payOpen}
        title="Record payment"
        onClose={() => setPayOpen(false)}
        footer={
          <Button className="w-full" loading={busy} onClick={savePayment}>
            Save payment
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Amount (Rs)">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
          </Field>
          <Field label="Apply to bill">
            <Select value={saleId} onChange={(e) => setSaleId(e.target.value)}>
              <option value="">General payment</option>
              {bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.invoice_no} · due {fmtMoney(Number(b.total) - Number(b.paid))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank">Bank transfer</option>
            </Select>
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export default function Customers() {
  const { version, bump } = useApp();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data, loading, error, reload } = useAsync(() => api.customers(), [version]);
  const categories = useAsync(() => api.customerCategories(), [version]);

  const list = (data || []).filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${c.name} ${c.phone} ${c.email} ${c.barcode || ""}`.toLowerCase().includes(q);
  });

  const remove = async () => {
    try {
      await api.deleteCustomer(deleting.id);
      showToast("Customer deleted");
      setDeleting(null);
      bump();
      reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const changed = () => {
    bump();
    reload();
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Customers"
        subtitle={`${list.length} customer${list.length === 1 ? "" : "s"}`}
        right={
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />

      <div className="px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customers" className="pl-9" />
        </div>
      </div>

      <div className="mt-3 px-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-brand-600" />
          </div>
        ) : error ? (
          <Card className="border border-red-100 bg-red-50">
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        ) : list.length ? (
          <div className="space-y-2">
            {list.map((c) => (
              <Card key={c.id} className="flex items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => setSelected(c)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{c.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {c.phone || "No phone"} · {c.total_bills || 0} bills
                    </p>
                    {c.barcode ? (
                      <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] font-semibold text-slate-500">
                        <Barcode className="h-3 w-3" /> {c.barcode}
                      </p>
                    ) : null}
                    {Number(c.balance) > 0 ? (
                      <p className="text-[11px] font-semibold text-amber-600">Due {fmtMoney(c.balance)}</p>
                    ) : null}
                  </div>
                </button>
                <div className="flex shrink-0 flex-col gap-1">
                  <IconButton
                    onClick={() => { setEditing(c); setFormOpen(true); }}
                    className="h-8 w-8 bg-slate-100"
                    aria-label="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    onClick={() => setDeleting(c)}
                    className="h-8 w-8 bg-red-50 text-red-500"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty
            icon={Users}
            title="No customers yet"
            description="Add customers to track bills and payments."
            action={<Button onClick={() => { setEditing(null); setFormOpen(true); }}>Add customer</Button>}
          />
        )}
      </div>

      <CustomerForm
        open={formOpen}
        customer={editing}
        categories={categories.data || []}
        onClose={() => setFormOpen(false)}
        onSaved={changed}
      />

      <CustomerDetail
        open={!!selected}
        customer={selected}
        onClose={() => setSelected(null)}
        onChanged={changed}
      />

      <Confirm
        open={!!deleting}
        title="Delete customer?"
        message={`"${deleting?.name || ""}" will be removed. Their past bills stay in Sales.`}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </div>
  );
}
