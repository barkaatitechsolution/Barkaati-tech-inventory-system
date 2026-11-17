import { useEffect, useMemo, useState } from "react";
import { Boxes, Plus, Trash2, Truck } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import {
  Badge,
  Button,
  Card,
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

function SupplierForm({ open, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", company: "", phone: "", email: "", address: "", notes: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm({ name: "", company: "", phone: "", email: "", address: "", notes: "" });
  }, [open]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    if (!form.name.trim()) return showToast("Supplier name is required", "error");
    setSaving(true);
    try {
      await api.createSupplier(form);
      showToast("Supplier added");
      onSaved?.();
      onClose();
    } catch (e) {
      showToast(e?.message || "Could not add supplier", "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      title="New supplier"
      onClose={onClose}
      footer={<Button className="w-full" loading={saving} onClick={save}>Add supplier</Button>}
    >
      <div className="space-y-3">
        <Field label="Name"><Input value={form.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Company"><Input value={form.company} onChange={set("company")} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Phone"><Input value={form.phone} onChange={set("phone")} inputMode="tel" /></Field>
          <Field label="Email"><Input value={form.email} onChange={set("email")} inputMode="email" /></Field>
        </div>
        <Field label="Address"><Textarea value={form.address} onChange={set("address")} rows={2} /></Field>
        <Field label="Notes"><Textarea value={form.notes} onChange={set("notes")} rows={2} /></Field>
      </div>
    </Modal>
  );
}

function PurchaseForm({ open, suppliers, products, onClose, onSaved, onAddSupplier }) {
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([]);
  const [additional, setAdditional] = useState("");
  const [discount, setDiscount] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierId("");
    setInvoiceNo("");
    setDate(new Date().toISOString().slice(0, 10));
    setLines([]);
    setAdditional("");
    setDiscount("");
    setPaid("");
    setMethod("cash");
    setNotes("");
  }, [open]);

  const addLine = () => setLines((l) => [...l, { product_id: "", qty: "1", purchase_price: "" }]);
  const updateLine = (idx, key, value) =>
    setLines((l) => l.map((line, i) => (i === idx ? { ...line, [key]: value } : line)));
  const removeLine = (idx) => setLines((l) => l.filter((_, i) => i !== idx));

  const subtotal = useMemo(
    () => lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.purchase_price) || 0), 0),
    [lines]
  );
  const total = Math.max(0, subtotal - (Number(discount) || 0) + (Number(additional) || 0));

  const save = async () => {
    const items = lines
      .filter((l) => l.product_id && Number(l.qty) > 0)
      .map((l) => ({
        product_id: Number(l.product_id),
        qty: Number(l.qty),
        purchase_price: Number(l.purchase_price) || 0
      }));
    if (!items.length) return showToast("Add at least one product line", "error");
    setSaving(true);
    try {
      await api.createSupplierPurchase({
        supplier_id: supplierId || null,
        invoice_no: invoiceNo,
        purchased_at: date,
        items,
        discount: Number(discount) || 0,
        additional_charges: Number(additional) || 0,
        paid: paid === "" ? total : Number(paid) || 0,
        payment_method: method,
        notes
      });
      showToast("Purchase saved, stock updated");
      onSaved?.();
      onClose();
    } catch (e) {
      showToast(e?.message || "Could not save purchase", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="New purchase"
      onClose={onClose}
      wide
      footer={<Button className="w-full" loading={saving} onClick={save}>Save purchase · {fmtMoney(total)}</Button>}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Supplier">
            <div className="flex gap-1">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">None</option>
                {(suppliers || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              <IconButton onClick={onAddSupplier} className="h-11 w-11 shrink-0 bg-slate-100" aria-label="Add supplier">
                <Plus className="h-4 w-4" />
              </IconButton>
            </div>
          </Field>
          <Field label="Invoice no.">
            <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Payment">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank">Bank</option>
              <option value="credit">Credit</option>
            </Select>
          </Field>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Items</p>
          <Button size="sm" variant="secondary" onClick={addLine}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </Button>
        </div>

        {lines.map((line, idx) => (
          <div key={idx} className="rounded-xl border border-slate-200 p-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  value={line.product_id}
                  onChange={(e) => {
                    const p = (products || []).find((x) => String(x.id) === e.target.value);
                    updateLine(idx, "product_id", e.target.value);
                    if (p) updateLine(idx, "purchase_price", String(p.purchase_price || ""));
                  }}
                >
                  <option value="">Choose product</option>
                  {(products || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
              <IconButton onClick={() => removeLine(idx)} className="h-9 w-9 text-red-500" aria-label="Remove">
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                value={line.qty}
                onChange={(e) => updateLine(idx, "qty", e.target.value)}
                inputMode="decimal"
                placeholder="Qty"
              />
              <Input
                value={line.purchase_price}
                onChange={(e) => updateLine(idx, "purchase_price", e.target.value)}
                inputMode="decimal"
                placeholder="Cost / unit"
              />
            </div>
          </div>
        ))}

        <div className="grid grid-cols-3 gap-2">
          <Field label="Discount"><Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" /></Field>
          <Field label="Extra charges"><Input value={additional} onChange={(e) => setAdditional(e.target.value)} inputMode="decimal" /></Field>
          <Field label="Paid now"><Input value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" placeholder={String(total)} /></Field>
        </div>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtMoney(subtotal)}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900"><span>Total</span><span>{fmtMoney(total)}</span></div>
        </div>
      </div>
    </Modal>
  );
}

export default function Purchases() {
  const { version, bump } = useApp();
  const [formOpen, setFormOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState("");

  const purchases = useAsync(() => api.supplierPurchases(), [version]);
  const suppliers = useAsync(() => api.suppliers(), [version]);
  const products = useAsync(() => api.productOptions(), [version]);

  const list = (purchases.data || []).filter((p) => {
    if (!supplierFilter) return true;
    return String(p.supplier_id) === String(supplierFilter);
  });

  const changed = () => {
    bump();
    purchases.reload();
    suppliers.reload();
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Purchases"
        subtitle={`${list.length} purchase${list.length === 1 ? "" : "s"}`}
        right={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> New
          </Button>
        }
      />

      <div className="px-4">
        <div className="flex gap-2">
          <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="flex-1">
            <option value="">All suppliers</option>
            {(suppliers.data || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => setSupplierOpen(true)}>Suppliers</Button>
        </div>
      </div>

      <div className="mt-3 px-4">
        {purchases.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : purchases.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{purchases.error}</p></Card>
        ) : list.length ? (
          <div className="space-y-2">
            {list.map((p) => {
              const balance = Number(p.total) - Number(p.paid);
              return (
                <Card key={p.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{p.supplier_name || "No supplier"}</p>
                      <p className="text-[11px] text-slate-400">
                        {p.invoice_no || "No invoice"} · {fmtDate(p.purchased_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{fmtMoney(p.total)}</p>
                      <Badge tone={balance <= 0 ? "green" : "amber"}>
                        {balance <= 0 ? "paid" : `due ${fmtMoney(balance)}`}
                      </Badge>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={Truck}
            title="No purchases yet"
            description="Record stock you buy from suppliers here."
            action={<Button onClick={() => setFormOpen(true)}>New purchase</Button>}
          />
        )}
      </div>

      <PurchaseForm
        open={formOpen}
        suppliers={suppliers.data || []}
        products={products.data || []}
        onClose={() => setFormOpen(false)}
        onSaved={changed}
        onAddSupplier={() => setSupplierOpen(true)}
      />
      <SupplierForm
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        onSaved={() => { suppliers.reload(); bump(); }}
      />
    </div>
  );
}
