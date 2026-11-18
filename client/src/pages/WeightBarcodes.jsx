import { useCallback, useEffect, useMemo, useState } from "react";
import { Barcode, Check, Info, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Button, Field, Input } from "../components/Field.jsx";
import { barcodeSvg } from "../lib/barcode.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { printBarcodeLabelsOnLaptop } from "../lib/printRemote.js";

const PRESETS = ["250g", "500g", "750g", "1kg", "1.5kg", "2kg"];

const roundGrams = (value) => Math.round((Number(value) || 0) * 1000) / 1000;

const labelOf = (grams) => {
  const g = roundGrams(grams);
  if (g >= 1000) return `${Math.round((g / 1000) * 1000) / 1000} kg`;
  return `${g} g`;
};

const barcodeOf = (grams) => `WT:${roundGrams(grams)}`;

function parseWeights(text) {
  const grams = [];
  for (const part of String(text || "").split(/[,;\n]+/)) {
    const token = part.trim();
    if (!token) continue;
    const match = /^(\d+(?:\.\d+)?)\s*(kgs?|kilograms?|gms?|grams?|g)?$/i.exec(token);
    if (!match) return { error: `Cannot read "${token}". Use values like 500g or 1.5kg.` };
    const value = Number(match[1]);
    const unit = (match[2] || "g").toLowerCase();
    const parsed = roundGrams(/^k/.test(unit) ? value * 1000 : value);
    if (!(parsed > 0) || parsed > 1000000) {
      return { error: `Weight "${token}" is out of range.` };
    }
    if (!grams.includes(parsed)) grams.push(parsed);
  }
  if (!grams.length) return { error: "Enter at least one weight." };
  return { grams };
}

export default function WeightBarcodes() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [query, setQuery] = useState("");
  const [weightsText, setWeightsText] = useState("250g, 500g, 1kg");
  const [copies, setCopies] = useState("1");
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.weightBarcodes());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const parsed = useMemo(() => parseWeights(weightsText), [weightsText]);
  const previews = useMemo(
    () =>
      parsed.error
        ? []
        : parsed.grams.map((grams) => ({
            grams,
            label: labelOf(grams),
            barcode: barcodeOf(grams)
          })),
    [parsed]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.weight_label, r.barcode].some((value) =>
        String(value || "").toLowerCase().includes(needle)
      )
    );
  }, [rows, query]);

  const create = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (parsed.error) {
      setFormError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const result = await api.createWeightBarcodes({
        weights: parsed.grams,
        copies: Math.max(1, Math.min(50, Number(copies) || 1))
      });
      setToast(
        `Created ${result.created.length} barcode${result.created.length === 1 ? "" : "s"}` +
          (result.skipped.length ? ` · ${result.skipped.length} already existed` : "")
      );
      setWeightsText("250g, 500g, 1kg");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const printLabels = async (list, labelCopies) => {
    if (!list.length) return;
    setPrintBusy(true);
    try {
      await printBarcodeLabelsOnLaptop(
        getStoreInfo(),
        list.map((r) => ({
          name: r.weight_label,
          barcode: r.barcode
        })),
        { copies: Math.max(1, Math.min(50, Number(labelCopies) || 1)) }
      );
      setToast(`Sent ${list.length} label${list.length === 1 ? "" : "s"} to the printer`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPrintBusy(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await api.deleteWeightBarcode(toDelete.id);
      setRows((prev) => prev.filter((r) => String(r.id) !== String(toDelete.id)));
      setToast("Weight barcode deleted");
    } catch (err) {
      setError(err.message);
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="border border-indigo-100 bg-indigo-50/60 !p-4">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
          <div className="text-sm text-indigo-900">
            <p className="font-semibold">How it works</p>
            <p className="mt-1 text-indigo-700">
              Make one label per weight and stick it on your packs. In Sales, select the item line
              first, then scan the weight label — that line's quantity changes to the scanned weight.
              The weight is converted using that item's unit (500 g becomes 0.5 for a kg item).
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">Create weight barcodes</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Generic codes that work with any product. No product is stored in the barcode.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-[11px] text-slate-500">
            WT:grams
          </span>
        </div>

        <form onSubmit={create} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_140px] sm:items-end">
            <Field
              label="Weights"
              required
              hint="Separate multiple weights with commas, e.g. 250g, 500g, 1.5kg"
            >
              <Input
                value={weightsText}
                onChange={(e) => setWeightsText(e.target.value)}
                placeholder="500g, 1.5kg"
              />
            </Field>
            <Field label="Copies" hint="Per label">
              <Input
                type="number"
                min="1"
                max="50"
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Quick fill</span>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setWeightsText(preset)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : <><Plus className="h-4 w-4" /> Create barcodes</>}
            </Button>
          </div>

          {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}

          {!!previews.length && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {previews.map((item) => (
                  <div key={item.barcode} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                    <p className="text-sm font-bold text-slate-800">{item.label}</p>
                    <div
                      className="barcode-preview mt-2 overflow-hidden"
                      dangerouslySetInnerHTML={{ __html: barcodeSvg(item.barcode, { height: 34, width: 1.2, fontSize: 9 }) }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
      </Card>

      <Card className="!p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-5">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search weights or barcodes..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
              <span className="text-[11px] font-semibold text-slate-500">Copies</span>
              <input
                type="number"
                min="1"
                max="50"
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
                className="w-12 bg-transparent text-sm font-semibold text-slate-700 outline-none"
              />
            </div>
            <Button
              variant="ghost"
              disabled={printBusy || !filtered.length}
              onClick={() => printLabels(filtered, copies)}
            >
              <Printer className="h-4 w-4" /> {printBusy ? "Printing…" : "Print all"}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : error ? (
          <p className="p-5 text-sm text-rose-600">Failed to load barcodes: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Barcode className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No weight barcodes yet</p>
            <p className="mt-1 text-sm text-slate-500">Add the weights you sell above.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3">Weight</th>
                    <th className="px-3 py-3">Barcode</th>
                    <th className="px-3 py-3 text-right">Copies</th>
                    <th className="px-5 py-3 text-right">—</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                          {row.weight_label}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-600">{row.barcode}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{row.copies}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => printLabels([row], row.copies || copies)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                            aria-label="Print label"
                            title="Print label"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setToDelete(row)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label="Delete barcode"
                            title="Delete barcode"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 md:hidden">
              {filtered.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800">{row.weight_label}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">{row.barcode}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{row.copies} copies</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => printLabels([row], row.copies || copies)}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                    aria-label="Print label"
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setToDelete(row)}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Delete barcode"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete weight barcode?"
        message={toDelete ? `This removes the ${toDelete.weight_label} barcode. Printed labels will stop working in Sales.` : ""}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-xl">
          <Check className="h-4 w-4 text-emerald-400" /> {toast}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
      )}
    </div>
  );
}
