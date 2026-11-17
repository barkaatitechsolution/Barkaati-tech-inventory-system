import { useEffect, useMemo, useState } from "react";
import { Boxes, PackageMinus, Pencil, Plus, Search, Trash2 } from "lucide-react";
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

const UNITS = ["pcs", "pack", "box", "kg", "g", "roll", "sheet", "bundle", "carton"];

const blank = () => ({
  name: "",
  size: "",
  unit: "pcs",
  qty: "",
  amount: "",
  purchase_date: new Date().toISOString().slice(0, 10),
  notes: ""
});

export default function NonSaleInventory() {
  const { version, bump } = useApp();
  const items = useAsync(() => api.nonSaleInventory(), [version]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [using, setUsing] = useState(null);
  const [useQty, setUseQty] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm(editing ? formFrom(editing) : blank());
  }, [open, editing]);

  const rows = items.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.size, r.unit, r.notes].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    const spent = rows.reduce((n, r) => n + (Number(r.amount) || 0), 0);
    const remaining = rows.reduce((n, r) => n + (Number(r.remaining) || 0), 0);
    return { spent, remaining, count: rows.length };
  }, [rows]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setOpen(true);
  };

  const save = async () => {
    const qty = Number(form.qty) || 0;
    if (!form.name.trim()) return showToast("Enter an item name", "error");
    if (qty <= 0) return showToast("Enter a quantity", "error");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        size: form.size,
        unit: form.unit,
        qty,
        amount: Number(form.amount) || 0,
        purchase_date: form.purchase_date,
        notes: form.notes
      };
      if (editing) {
        const remaining = Math.max(0, (Number(editing.remaining) || 0) + (qty - (Number(editing.qty) || 0)));
        await api.updateNonSaleItem(editing.id, { ...payload, remaining });
        showToast("Item updated");
      } else {
        await api.createNonSaleItem({ ...payload, remaining: qty });
        showToast("Item added");
      }
      setOpen(false);
      bump();
      items.reload();
    } catch (e) {
      showToast(e?.message || "Could not save item", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteNonSaleItem(deleting.id);
      showToast("Item deleted");
      setDeleting(null);
      bump();
      items.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const confirmUse = async () => {
    const qty = Number(useQty) || 0;
    if (qty <= 0) return showToast("Enter a quantity", "error");
    setBusy(true);
    try {
      await api.useNonSaleItem(using.id, { qty });
      showToast("Usage recorded");
      setUsing(null);
      setUseQty("");
      bump();
      items.reload();
    } catch (e) {
      showToast(e?.message || "Could not record usage", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Non-sale stock"
        subtitle={`${totals.count} items · ${fmtMoney(totals.spent)} spent`}
        right={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />

      <div className="space-y-3 px-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Purchased value</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{fmtMoney(totals.spent)}</p>
          </Card>
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Remaining units</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{totals.remaining}</p>
          </Card>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items"
          />
        </div>

        {items.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : items.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{items.error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => {
              const qty = Number(r.qty) || 0;
              const remaining = Number(r.remaining) || 0;
              const used = Math.max(0, qty - remaining);
              return (
                <Card key={r.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                      <Boxes className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {r.name}
                        {r.size ? <span className="font-normal text-slate-400"> · {r.size}</span> : null}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {fmtDate(r.purchase_date)} · {fmtMoney(r.amount)}
                        {r.notes ? ` · ${r.notes}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge tone={remaining <= 0 ? "red" : "green"}>
                        {remaining} / {qty} {r.unit || "pcs"}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-400">{used} used</p>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setUsing(r);
                          setUseQty("");
                        }}
                        disabled={remaining <= 0}
                      >
                        <PackageMinus className="h-3.5 w-3.5" /> Use
                      </Button>
                      <IconButton onClick={() => openEdit(r)} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton onClick={() => setDeleting(r)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={Boxes}
            title="No non-sale items"
            description="Track shop supplies like bags, tags and packaging."
            action={<Button onClick={openCreate}>Add item</Button>}
          />
        )}
      </div>

      <Modal
        open={open}
        title={editing ? "Edit item" : "Add non-sale item"}
        onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save item</Button>}
      >
        <div className="space-y-3">
          <Field label="Item name">
            <Input value={form.name} onChange={set("name")} placeholder="e.g. Carry bags" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Size">
              <Input value={form.size} onChange={set("size")} placeholder="Optional" />
            </Field>
            <Field label="Unit">
              <Select value={form.unit} onChange={set("unit")}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity">
              <Input value={form.qty} onChange={set("qty")} inputMode="decimal" />
            </Field>
            <Field label="Total amount (Rs)">
              <Input value={form.amount} onChange={set("amount")} inputMode="decimal" />
            </Field>
          </div>
          <Field label="Purchase date">
            <Input type="date" value={form.purchase_date} onChange={set("purchase_date")} />
          </Field>
          <Field label="Notes">
            <Textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="Optional" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!using}
        title="Record usage"
        onClose={() => setUsing(null)}
        footer={<Button className="w-full" loading={busy} onClick={confirmUse}>Record usage</Button>}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {using?.name} · {Number(using?.remaining) || 0} {using?.unit || "pcs"} remaining
          </p>
          <Field label="Quantity used">
            <Input value={useQty} onChange={(e) => setUseQty(e.target.value)} inputMode="decimal" autoFocus />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={!!deleting}
        title="Delete item?"
        message="This item will be removed from non-sale stock."
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </div>
  );
}

function formFrom(row) {
  return {
    name: row.name || "",
    size: row.size || "",
    unit: row.unit || "pcs",
    qty: String(row.qty ?? ""),
    amount: String(row.amount ?? ""),
    purchase_date: row.purchase_date || new Date().toISOString().slice(0, 10),
    notes: row.notes || ""
  };
}
