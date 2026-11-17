import { useEffect, useState } from "react";
import { PackageMinus, Plus, Trash2 } from "lucide-react";
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
  product_id: "",
  qty: "",
  unit_cost: "",
  reason: "Damaged",
  notes: ""
});

export default function StockRemoval() {
  const { version, bump } = useApp();
  const removals = useAsync(() => api.stockRemovals(), [version]);
  const products = useAsync(() => api.productOptions(), [version]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (open) setForm(blank());
  }, [open]);

  const rows = removals.data || [];
  const options = products.data || [];
  const totalValue = rows.reduce((n, r) => n + (Number(r.value) || 0), 0);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.product_id) return showToast("Choose a product", "error");
    if (!(Number(form.qty) > 0)) return showToast("Enter a quantity", "error");
    setSaving(true);
    try {
      await api.createStockRemoval({
        ...form,
        qty: Number(form.qty) || 0,
        unit_cost: form.unit_cost === "" ? undefined : Number(form.unit_cost) || 0
      });
      showToast("Stock removed");
      setOpen(false);
      bump();
      removals.reload();
      products.reload();
    } catch (e) {
      showToast(e?.message || "Could not remove stock", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteStockRemoval(deleting.id);
      showToast("Removal reversed");
      setDeleting(null);
      bump();
      removals.reload();
      products.reload();
    } catch (e) {
      showToast(e?.message || "Could not reverse", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Stock removal" subtitle={`${rows.length} entries · ${fmtMoney(totalValue)} written off`}
        right={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Remove</Button>} />

      <div className="space-y-3 px-4">
        {removals.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : removals.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{removals.error}</p></Card>
        ) : rows.length ? (
          <div className="space-y-2">
            {rows.map((r) => (
              <Card key={r.id} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                  <PackageMinus className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{r.product_name}</p>
                  <p className="truncate text-[11px] text-slate-400">{fmtDate(r.created_at)} · {r.reason || "No reason"}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">-{r.qty}</p>
                  <Badge tone="red">{fmtMoney(r.value)}</Badge>
                </div>
                <IconButton onClick={() => setDeleting(r)} className="h-8 w-8 bg-slate-100 text-slate-500" aria-label="Reverse">
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={PackageMinus} title="No removals" description="Write off damaged, lost or expired stock here."
            action={<Button onClick={() => setOpen(true)}>Remove stock</Button>} />
        )}
      </div>

      <Modal open={open} title="Remove stock" onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Remove from stock</Button>}>
        <div className="space-y-3">
          <Field label="Product">
            <Select value={form.product_id} onChange={set("product_id")}>
              <option value="">Choose a product</option>
              {options.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.stock} {p.unit || "pcs"}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity"><Input value={form.qty} onChange={set("qty")} inputMode="decimal" /></Field>
            <Field label="Unit cost (Rs)"><Input value={form.unit_cost} onChange={set("unit_cost")} inputMode="decimal" placeholder="Purchase cost" /></Field>
          </div>
          <Field label="Reason">
            <Select value={form.reason} onChange={set("reason")}>
              {["Damaged", "Expired", "Lost", "Sample", "Internal use", "Other"].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={set("notes")} rows={2} /></Field>
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Reverse removal?" message="This will add the quantity back to stock."
        confirmLabel="Reverse" onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}
