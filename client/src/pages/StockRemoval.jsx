import { useEffect, useMemo, useState } from "react";
import {
  PackageMinus,
  Plus,
  Trash2,
  RefreshCw,
  RotateCcw,
  History,
  AlertTriangle,
  CheckCircle2
} from "lucide-react";
import { api } from "../api";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Modal from "../components/Modal.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import { fmtDateTime, fmtMoney } from "../lib/format";

// Why stock left the shelf without being sold. The server keeps the same
// list, so a reason typed here is always one the API accepts.
const REASONS = [
  { value: "damaged", label: "Damaged / broken" },
  { value: "expired", label: "Expired" },
  { value: "personal", label: "Used personally" },
  { value: "supplier", label: "Returned to supplier" },
  { value: "loss", label: "Lost / stolen" },
  { value: "sample", label: "Sample / display" },
  { value: "other", label: "Other" }
];

const REASON_PILL = {
  damaged: "bg-rose-50 text-rose-700",
  expired: "bg-amber-50 text-amber-700",
  personal: "bg-violet-50 text-violet-700",
  supplier: "bg-sky-50 text-sky-700",
  loss: "bg-slate-100 text-slate-700",
  sample: "bg-indigo-50 text-indigo-700",
  other: "bg-slate-100 text-slate-600"
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Stock is fractional (half a pack), so trim the trailing zeros rather than
// showing "12.0000".
const fmtQty = (value) => (Number(value) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });

const reasonLabel = (value) =>
  (REASONS.find((r) => r.value === value) || { label: "Other" }).label;

export default function StockRemoval() {
  const [products, setProducts] = useState([]);
  const [removals, setRemovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [reason, setReason] = useState("damaged");
  const [note, setNote] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [p, r] = await Promise.all([api.productOptions(), api.stockRemovals({ limit: 50 })]);
      setProducts(p || []);
      setRemovals(r || []);
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

  const productById = useMemo(() => {
    const m = {};
    for (const p of products) m[p.id] = p;
    return m;
  }, [products]);

  // Only products that still have stock on hand can be written off.
  const productOptions = useMemo(
    () =>
      products
        .filter((p) => (Number(p.stock) || 0) > 0)
        .map((p) => ({
          value: String(p.id),
          label: `${p.name} · ${fmtQty(p.stock)} ${p.unit || "pcs"} in stock`
        })),
    [products]
  );

  const selected = productById[productId] || null;

  // How much of a product is still free to write off: what is on the shelf
  // minus whatever this form has already lined up.
  const availableOf = (id) => {
    const p = productById[id];
    if (!p) return 0;
    const onHand = Number(p.stock) || 0;
    const lined = lines
      .filter((l) => String(l.product_id) === String(id))
      .reduce((s, l) => s + (Number(l.qty) || 0), 0);
    return round2(onHand - lined);
  };

  const addLine = () => {
    setError(null);
    if (!selected) {
      setError("Pick a product to remove from stock");
      return;
    }
    const amount = round2(qty);
    if (!(amount > 0)) {
      setError("Enter how much stock to remove");
      return;
    }
    const free = availableOf(selected.id);
    if (amount > free) {
      setError(
        free > 0
          ? `Only ${fmtQty(free)} ${selected.unit || "pcs"} of "${selected.name}" left in stock`
          : `No more stock left for "${selected.name}"`
      );
      return;
    }
    const unitCost = Number(selected.purchase_price) || 0;
    setLines((prev) => {
      const existing = prev.find((l) => String(l.product_id) === String(selected.id));
      if (existing) {
        return prev.map((l) =>
          String(l.product_id) === String(selected.id)
            ? { ...l, qty: round2(Number(l.qty) + amount) }
            : l
        );
      }
      return [
        ...prev,
        {
          product_id: selected.id,
          name: selected.name,
          unit: selected.unit || "pcs",
          qty: amount,
          unit_cost: unitCost
        }
      ];
    });
    setQty("");
  };

  const updateLineQty = (id, value) => {
    const next = round2(value);
    const free = availableOf(id);
    setLines((prev) =>
      prev.map((l) =>
        String(l.product_id) === String(id)
          ? { ...l, qty: next > free ? free : next < 0 ? 0 : next }
          : l
      )
    );
  };

  const removeLine = (id) => {
    setLines((prev) => prev.filter((l) => String(l.product_id) !== String(id)));
  };

  const totals = useMemo(() => {
    const totalQty = round2(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0));
    const totalValue = round2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0));
    return { totalQty, totalValue };
  }, [lines]);

  const historyTotals = useMemo(() => {
    const qty = round2(removals.reduce((s, r) => s + (Number(r.total_qty) || 0), 0));
    const value = round2(removals.reduce((s, r) => s + (Number(r.total_value) || 0), 0));
    return { qty, value, count: removals.length };
  }, [removals]);

  const submit = async () => {
    if (lines.length === 0) {
      setError("Add at least one product to remove");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.createStockRemoval({
        reason,
        note: note.trim() || null,
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty }))
      });
      setSuccess(res);
      setLines([]);
      setNote("");
      setQty("");
      setProductId("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    if (!restoring) return;
    try {
      await api.deleteStockRemoval(restoring.id);
      setRestoring(null);
      setSuccess({ restored: true, items: restoring.item_count });
      await load();
    } catch (e) {
      setError(e.message);
      setRestoring(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={PackageMinus}
          label="Units written off"
          value={fmtQty(historyTotals.qty)}
          sub="across all recorded removals"
          tone="rose"
        />
        <StatCard
          icon={AlertTriangle}
          label="Value lost"
          value={fmtMoney(historyTotals.value)}
          sub="at purchase cost"
          tone="amber"
        />
        <StatCard
          icon={History}
          label="Removals"
          value={historyTotals.count}
          sub="entries in the register"
          tone="violet"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success.restored
            ? `Stock restored — ${success.items} item(s) put back into inventory`
            : `Removed ${success.items_removed} item(s) · ${fmtQty(success.total_qty)} units · ${fmtMoney(
                success.total_value
              )} written off`}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Remove stock</h3>
            <p className="text-xs text-slate-400">
              Write off damaged, expired or personally used stock. The units leave the shelf and the
              Stock Levels page drops by the same amount.
            </p>
          </div>
          <Button variant="ghost" className="!p-2" title="Refresh" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Reason" required>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Product" required className="lg:col-span-2">
            <SearchableSelect
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              options={productOptions}
              placeholder="Search a product…"
              searchPlaceholder="Search products…"
            />
            {selected && (
              <span className="mt-1 block text-[11px] text-slate-400">
                {fmtQty(availableOf(selected.id))} {selected.unit || "pcs"} available to remove
              </span>
            )}
          </Field>

          <Field label="Quantity" required>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLine()}
                placeholder="0"
              />
              <Button variant="soft" onClick={addLine} className="!px-3" title="Add to removal">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </Field>
        </div>

        {lines.length > 0 && (
          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
            {lines.map((l) => (
              <div key={l.product_id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-semibold text-slate-800">{l.name}</p>
                  <p className="text-xs text-slate-400">
                    {fmtMoney(l.unit_cost)} per {l.unit} ·{" "}
                    {fmtMoney((Number(l.qty) || 0) * (Number(l.unit_cost) || 0))} value
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={l.qty}
                    onChange={(e) => updateLineQty(l.product_id, e.target.value)}
                    className="!w-24 !px-2 !py-1.5 text-center"
                  />
                  <span className="text-xs text-slate-400">{l.unit}</span>
                </div>
                <button
                  onClick={() => removeLine(l.product_id)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Remove from list"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Note (optional)">
              <Textarea
                rows={2}
                placeholder="Which pack broke, who took it home…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Written off</p>
            <p className="text-2xl font-bold text-rose-600">{fmtMoney(totals.totalValue)}</p>
            <p className="mt-1 text-[11px] text-slate-400">
              {lines.length} line(s) · {fmtQty(totals.totalQty)} units
            </p>
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <Button variant="danger" onClick={submit} disabled={saving || lines.length === 0}>
            {saving ? "Removing…" : `Remove ${lines.length} item(s) from stock`}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Removal register</h3>
            <p className="text-xs text-slate-400">
              Every write-off, with the reason. A mistaken entry can be put back into stock.
            </p>
          </div>
          <Button variant="ghost" className="!p-2" title="Refresh" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="mt-3 divide-y divide-slate-100">
          {loading ? (
            <p className="px-1 py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : removals.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <PackageMinus className="h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-400">No stock removed yet</p>
              <p className="mt-1 text-xs text-slate-400">
                Damaged, expired or personally used stock will show up here.
              </p>
            </div>
          ) : (
            removals.map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold ${
                      REASON_PILL[r.reason] || REASON_PILL.other
                    }`}
                  >
                    {reasonLabel(r.reason)}
                  </span>
                  <span className="text-[11px] text-slate-400">{fmtDateTime(r.created_at)}</span>
                  <span className="ml-auto text-sm font-bold text-rose-600">
                    -{fmtQty(r.total_qty)} units
                  </span>
                  <span className="text-sm font-semibold text-slate-700">
                    {fmtMoney(r.total_value)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {(r.items || [])
                    .map((i) => `${i.product_name} (${fmtQty(i.qty)} ${i.unit_name || "pcs"})`)
                    .join(", ")}
                </p>
                {r.note && <p className="mt-0.5 text-[11px] italic text-slate-400">"{r.note}"</p>}
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    className="!px-3 !py-1.5 text-xs"
                    onClick={() => setRestoring(r)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Put back into stock
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Modal
        open={!!restoring}
        onClose={() => setRestoring(null)}
        title="Put the stock back?"
        subtitle="The removal is removed from the register and the units return to the shelf."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoring(null)}>
              Cancel
            </Button>
            <Button onClick={restore}>
              <RotateCcw className="h-4 w-4" />
              Restore stock
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {restoring
            ? `This restores ${fmtQty(restoring.total_qty)} unit(s) (${fmtMoney(
                restoring.total_value
              )} at cost) from the "${reasonLabel(restoring.reason)}" entry.`
            : ""}
        </p>
      </Modal>
    </div>
  );
}
