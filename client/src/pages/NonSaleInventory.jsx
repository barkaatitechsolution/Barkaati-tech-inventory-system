import { useEffect, useMemo, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { Plus, Search, Boxes, Trash2, Pencil, PackageMinus, Package } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney, fmtDate } from "../lib/format.js";

const PAGE_SIZE = 20;

const UNITS = ["pcs", "pack", "box", "kg", "g", "roll", "sheet", "bundle", "carton"].map((u) => ({
  value: u,
  label: u
}));

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank Transfer" },
  { value: "online", label: "Online" }
];

const emptyForm = () => ({
  name: "",
  size: "",
  unit: "pcs",
  quantity_purchased: "",
  amount_per_unit: "",
  notes: "",
  payment_method: "cash"
});

export default function NonSaleInventory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [useItem, setUseItem] = useState(null);
  const [useQty, setUseQty] = useState("");
  const [using, setUsing] = useState(false);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.nonSaleInventory());
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
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.size, r.unit, r.notes].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const stats = useMemo(() => {
    const spent = rows.reduce((a, r) => a + (Number(r.total_amount) || 0), 0);
    const stockItems = rows.filter((r) => (Number(r.stock_remaining) || 0) > 0).length;
    return { spent, stockItems, count: rows.length };
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      size: row.size || "",
      unit: row.unit || "pcs",
      quantity_purchased: "",
      amount_per_unit: String(row.amount_per_unit ?? ""),
      notes: row.notes || "",
      payment_method: "cash"
    });
    setFormError(null);
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await api.updateNonSaleItem(editing.id, {
          name: form.name,
          size: form.size,
          unit: form.unit,
          amount_per_unit: Number(form.amount_per_unit) || 0,
          add_quantity: Number(form.quantity_purchased) || 0,
          notes: form.notes,
          payment_method: form.payment_method
        });
        setToast("Item updated");
      } else {
        await api.createNonSaleItem({
          name: form.name,
          size: form.size,
          unit: form.unit,
          quantity_purchased: Number(form.quantity_purchased) || 0,
          amount_per_unit: Number(form.amount_per_unit) || 0,
          notes: form.notes,
          payment_method: form.payment_method
        });
        setToast("Item added and expense recorded");
      }
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteNonSaleItem(toDelete.id);
      setToDelete(null);
      setToast("Item deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  const openUse = (row) => {
    setUseItem(row);
    setUseQty("");
    setFormError(null);
  };

  const confirmUse = async () => {
    const qty = Number(useQty) || 0;
    if (qty <= 0) {
      setFormError("Enter a quantity greater than 0");
      return;
    }
    setUsing(true);
    setFormError(null);
    try {
      await api.useNonSaleItem(useItem.id, { quantity: qty });
      setUseItem(null);
      setToast("Stock usage recorded");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setUsing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total Spent</p>
          <p className="mt-1 text-xl font-bold text-rose-600">{fmtMoney(stats.spent)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Items In Stock</p>
          <p className="mt-1 text-xl font-bold text-indigo-600">{stats.stockItems}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total Items</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{stats.count}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Item
          </Button>
        </div>
      </div>

      <Card className="!p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : error ? (
          <p className="p-5 text-sm text-rose-600">Failed to load items: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Boxes className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No non-sale items yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Record carry bags, packaging or other materials bought for the shop.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 sm:px-5">Item</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Size</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3 text-right">Rate</th>
                    <th className="px-3 py-3 text-right">Total</th>
                    <th className="px-3 py-3 text-right">Remaining</th>
                    <th className="px-3 py-3 text-right sm:px-5">—</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const remaining = Number(r.stock_remaining) || 0;
                    const low = remaining <= 0;
                    return (
                      <tr key={r.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                        <td className="px-3 py-3 sm:px-5">
                          <p className="font-medium text-slate-800">{r.name}</p>
                          {r.notes && <p className="text-[11px] text-slate-400">{r.notes}</p>}
                        </td>
                        <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">{r.size || "—"}</td>
                        <td className="px-3 py-3 text-right text-slate-600">
                          {Number(r.quantity_purchased) || 0} {r.unit}
                        </td>
                        <td className="px-3 py-3 text-right text-slate-600">{fmtMoney(r.amount_per_unit)}</td>
                        <td className="px-3 py-3 text-right font-bold text-rose-600">{fmtMoney(r.total_amount)}</td>
                        <td className="px-3 py-3 text-right">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                              low ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {remaining} {r.unit}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right sm:px-5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openUse(r)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                              aria-label="Record usage"
                              title="Record usage"
                              disabled={low}
                            >
                              <PackageMinus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => openEdit(r)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                              aria-label="Edit"
                              title="Edit / restock"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setToDelete(r)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 sm:hidden">
              {pageRows.map((r) => {
                const remaining = Number(r.stock_remaining) || 0;
                const low = remaining <= 0;
                return (
                  <div key={r.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-800">{r.name}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {r.size ? `${r.size} · ` : ""}
                          {Number(r.quantity_purchased) || 0} {r.unit} @ {fmtMoney(r.amount_per_unit)}
                        </p>
                        <span
                          className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            low ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {remaining} {r.unit} left
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <p className="text-sm font-bold text-rose-600">{fmtMoney(r.total_amount)}</p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openUse(r)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                            aria-label="Record usage"
                            disabled={low}
                          >
                            <PackageMinus className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEdit(r)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setToDelete(r)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!loading && !error && filtered.length > 0 && (
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Item" : "Add Non-Sale Item"}
        subtitle={
          editing
            ? "Update details or add more quantity (restock)"
            : "Buying this will be recorded as an expense"
        }
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Item name" required className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="e.g. Carry bag, bubble wrap"
              />
            </Field>
            <Field label="Size">
              <Input
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
                placeholder='e.g. Medium, 12"x16"'
              />
            </Field>
            <Field label="Unit">
              <SearchableSelect
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                options={UNITS}
                placeholder="Select unit"
                searchPlaceholder="Search units..."
              />
            </Field>
            <Field label={editing ? "Add quantity (restock)" : "Quantity purchased"}>
              <Input
                type="number"
                min="0"
                step="1"
                value={form.quantity_purchased}
                onChange={(e) => setForm({ ...form, quantity_purchased: e.target.value })}
                placeholder="0"
              />
            </Field>
            <Field label="Amount per unit">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amount_per_unit}
                onChange={(e) => setForm({ ...form, amount_per_unit: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Payment method">
              <SearchableSelect
                value={form.payment_method}
                onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                options={METHODS}
                placeholder="Select method"
                searchPlaceholder="Search methods..."
              />
            </Field>
            <Field label="Total" hint="Calculated from quantity × amount per unit">
              <Input
                value={fmtMoney((Number(form.quantity_purchased) || 0) * (Number(form.amount_per_unit) || 0))}
                readOnly
                disabled
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Anything worth remembering about this item"
            />
          </Field>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Item"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!useItem}
        onClose={() => setUseItem(null)}
        title="Record Usage"
        subtitle={useItem ? `${useItem.name} — ${Number(useItem.stock_remaining) || 0} ${useItem.unit} in stock` : ""}
      >
        <div className="space-y-4">
          <Field label={`Quantity used (${useItem?.unit || "pcs"})`} required>
            <Input
              type="number"
              min="0"
              step="1"
              value={useQty}
              onChange={(e) => setUseQty(e.target.value)}
              placeholder="0"
              autoFocus
            />
          </Field>
          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setUseItem(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmUse} disabled={using}>
              {using ? "Saving…" : "Record Usage"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete item?"
        message={`"${toDelete?.name}" will be permanently removed from non-sale inventory.`}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
