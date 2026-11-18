import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Barcode, Plus, Printer, Search, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { printWeightLabels } from "../lib/printer.js";
import {
  Badge,
  Button,
  Card,
  Confirm,
  Empty,
  Field,
  IconButton,
  Input,
  PageHeader,
  Spinner,
  Textarea,
  showToast
} from "../components/ui.jsx";

const PRESETS = [250, 500, 750, 1000, 1500, 2000];

function roundGrams(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function barcodeOf(grams) {
  return `WT:${roundGrams(grams)}`;
}

function labelOf(grams) {
  const value = roundGrams(grams);
  if (value < 1000) return `${value} g`;
  const kg = Math.round((value / 1000) * 1000) / 1000;
  return `${String(kg).replace(/\.?0+$/, "")} kg`;
}

function parseWeights(text) {
  const out = [];
  for (const part of String(text || "").split(/[\n,;]+/)) {
    const match = part.trim().match(/^(\d+(?:\.\d+)?)\s*(kg|kilogram|kilograms|g|gram|grams)?$/i);
    if (!match) continue;
    const amount = Number(match[1]);
    const unit = (match[2] || "g").toLowerCase();
    const grams = roundGrams(unit.startsWith("kg") || unit.startsWith("kilogram") ? amount * 1000 : amount);
    if (grams > 0 && !out.includes(grams)) out.push(grams);
  }
  return out;
}

function BarcodePreview({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        displayValue: false,
        height: 38,
        width: 1.4,
        margin: 0,
        background: "transparent"
      });
    } catch {
      /* preview is best-effort */
    }
  }, [value]);
  return <svg ref={ref} className="h-10 w-full" aria-label={value} />;
}

export default function WeightBarcodes() {
  const { store, version, bump } = useApp();
  const records = useAsync(() => api.weightBarcodes(), [version]);
  const [weightsText, setWeightsText] = useState("250g\n500g\n1kg");
  const [copies, setCopies] = useState("1");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const rows = records.data || [];
  const preview = useMemo(() => parseWeights(weightsText), [weightsText]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.barcode, r.weight_label, String(r.weight_g)].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  const addPreset = (grams) => {
    const next = [...new Set([...preview, grams])].sort((a, b) => a - b);
    setWeightsText(next.map(labelOf).join("\n"));
  };

  const save = async () => {
    if (!preview.length) return showToast("Enter at least one weight", "error");
    setSaving(true);
    try {
      const result = await api.createWeightBarcodes({
        weights: preview,
        copies: Number(copies) || 1
      });
      showToast(
        `${result.created.length} created${result.skipped.length ? `, ${result.skipped.length} already existed` : ""}`
      );
      bump();
      records.reload();
    } catch (e) {
      showToast(e?.message || "Could not save weight barcodes", "error");
    } finally {
      setSaving(false);
    }
  };

  const print = async (list) => {
    if (!list.length) return showToast("No labels to print", "error");
    setPrinting(true);
    try {
      await printWeightLabels(list, store || {});
      showToast(`Sent ${list.length} label${list.length === 1 ? "" : "s"} to printer`);
    } catch (e) {
      showToast(e?.message || "Printing failed", "error");
    } finally {
      setPrinting(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteWeightBarcode(deleting.id);
      showToast("Weight barcode deleted");
      setDeleting(null);
      bump();
      records.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Weight barcodes"
        subtitle={`${rows.length} generic weight${rows.length === 1 ? "" : "s"}`}
        right={
          <Button size="sm" variant="outline" loading={printing} onClick={() => print(filtered)}>
            <Printer className="h-4 w-4" /> Print all
          </Button>
        }
      />

      <div className="space-y-3 px-4">
        <Card className="p-3">
          <p className="text-xs leading-relaxed text-slate-500">
            Create labels like 250g or 1.5kg. In a sale, add an item first, then scan a label — its
            quantity is added using the item's sale unit.
          </p>
          <div className="mt-3">
            <Field label="Weights (one per line, or comma separated)">
              <Textarea
                value={weightsText}
                onChange={(e) => setWeightsText(e.target.value)}
                rows={3}
                placeholder="250g, 500g, 1kg, 1.5kg"
                inputMode="text"
              />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((grams) => (
              <button
                key={grams}
                type="button"
                onClick={() => addPreset(grams)}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 active:bg-slate-200"
              >
                + {labelOf(grams)}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <Field label="Copies per label">
              <Input value={copies} onChange={(e) => setCopies(e.target.value)} inputMode="numeric" />
            </Field>
            <div className="flex items-end">
              <Button loading={saving} onClick={save}>
                <Plus className="h-4 w-4" /> Create
              </Button>
            </div>
          </div>
          {preview.length ? (
            <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-2">
              {preview.map((grams) => (
                <div key={grams} className="rounded-lg bg-white p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800">{labelOf(grams)}</span>
                    <Badge tone="slate">{barcodeOf(grams)}</Badge>
                  </div>
                  <BarcodePreview value={barcodeOf(grams)} />
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search weight or barcode" />
        </div>

        {records.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((row) => (
              <Card key={row.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-slate-800">{row.weight_label}</p>
                    <p className="font-mono text-[11px] text-slate-400">{row.barcode}</p>
                  </div>
                  <div className="flex gap-1">
                    <IconButton
                      onClick={() => print([row])}
                      className="h-8 w-8 bg-brand-50 text-brand-700"
                      aria-label="Print label"
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      onClick={() => setDeleting(row)}
                      className="h-8 w-8 bg-red-50 text-red-500"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-2 rounded-lg bg-white p-2">
                  <BarcodePreview value={row.barcode} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Default copies: {row.copies}</p>
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={Barcode} title="No weight barcodes" description="Create labels like 500g, 250g or 1.5kg above." />
        )}
      </div>

      <Confirm
        open={!!deleting}
        title="Delete weight barcode?"
        message={`${deleting?.weight_label || ""} (${deleting?.barcode || ""}) will be removed from all devices.`}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </div>
  );
}
