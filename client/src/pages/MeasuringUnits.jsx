import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Ruler, Pencil, Trash2 } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";

const PAGE_SIZE = 15;

const CATEGORIES = [
  { value: "weight", label: "Weight" },
  { value: "volume", label: "Volume" },
  { value: "length", label: "Length" },
  { value: "count", label: "Count / Pieces" },
  { value: "other", label: "Other" }
];

const BASE_UNITS = {
  weight: [
    { value: "g", label: "Gram (g)" },
    { value: "kg", label: "Kilogram (kg)" }
  ],
  volume: [
    { value: "ml", label: "Millilitre (ml)" },
    { value: "l", label: "Litre (L)" }
  ],
  length: [
    { value: "mm", label: "Millimetre (mm)" },
    { value: "cm", label: "Centimetre (cm)" },
    { value: "m", label: "Metre (m)" }
  ],
  count: [
    { value: "pc", label: "Piece (pc)" }
  ],
  other: [
    { value: "pc", label: "Piece (pc)" }
  ]
};

const EMPTY = {
  name: "",
  short_name: "",
  category: "weight",
  base_unit: "g",
  conversion_factor: "1"
};

export default function MeasuringUnits() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.measuringUnits());
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
    const q = search.trim().toLowerCase();
    return rows.filter((u) => {
      const matchesQuery =
        !q ||
        [u.name, u.short_name, u.category, u.base_unit]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      const matchesCat = !catFilter || u.category === catFilter;
      return matchesQuery && matchesCat;
    });
  }, [rows, search, catFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, catFilter]);

  const stats = useMemo(() => {
    const byCat = {};
    rows.forEach((u) => {
      byCat[u.category] = (byCat[u.category] || 0) + 1;
    });
    return { total: rows.length, byCat };
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      name: u.name || "",
      short_name: u.short_name || "",
      category: u.category || "weight",
      base_unit: u.base_unit || "g",
      conversion_factor: u.conversion_factor?.toString() || "1"
    });
    setFormError(null);
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      short_name: form.short_name.trim(),
      category: form.category,
      base_unit: form.base_unit || null,
      conversion_factor: Number(form.conversion_factor) || 1
    };
    try {
      if (editing) await api.updateMeasuringUnit(editing.id, payload);
      else await api.createMeasuringUnit(payload);
      setOpen(false);
      setToast(editing ? "Unit updated" : "Unit added");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteMeasuringUnit(toDelete.id);
      setToDelete(null);
      setToast("Unit deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  const catColor = (c) => {
    const map = {
      weight: "bg-blue-50 text-blue-700",
      volume: "bg-cyan-50 text-cyan-700",
      length: "bg-purple-50 text-purple-700",
      count: "bg-emerald-50 text-emerald-700",
      other: "bg-slate-100 text-slate-600"
    };
    return map[c] || "bg-slate-100 text-slate-600";
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {CATEGORIES.map((c) => (
          <Card key={c.value} className="!p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{c.label}</p>
            <p className="mt-1 text-xl font-bold text-slate-800">{stats.byCat[c.value] || 0}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search units…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <SearchableSelect
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          options={[{ value: "", label: "All categories" }, ...CATEGORIES]}
          placeholder="All categories"
          searchPlaceholder="Search categories..."
          className="w-full sm:w-48"
        />
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Unit
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
          <p className="p-5 text-sm text-rose-600">Failed to load units: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Ruler className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No units found</p>
            <p className="mt-1 text-sm text-slate-500">Add a measuring unit to use in purchases and sales.</p>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-3 sm:px-5">Unit</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Short</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Base unit</th>
                  <th className="hidden px-3 py-3 text-right sm:table-cell">Factor</th>
                  <th className="px-3 py-3 text-right sm:px-5">—</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                    <td className="px-3 py-3 sm:px-5">
                      <p className="font-semibold text-slate-800">{u.name}</p>
                      <p className="font-mono text-xs text-slate-400 sm:hidden">{u.short_name}</p>
                    </td>
                    <td className="hidden px-3 py-3 font-mono text-sm text-slate-600 sm:table-cell">{u.short_name}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${catColor(u.category)}`}>
                        {u.category}
                      </span>
                    </td>
                    <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">{u.base_unit || "—"}</td>
                    <td className="hidden px-3 py-3 text-right text-slate-600 sm:table-cell">{u.conversion_factor}</td>
                    <td className="px-3 py-3 text-right sm:px-5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(u)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(u)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Delete"
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
        )}

        {!loading && !error && filtered.length > 0 && (
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Unit" : "Add Unit"}
        subtitle="Measuring unit details and conversion"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="e.g. Kilogram"
              />
            </Field>
            <Field label="Short name" required>
              <Input
                value={form.short_name}
                onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                required
                placeholder="e.g. kg"
              />
            </Field>
            <Field label="Category">
              <SearchableSelect
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value, base_unit: BASE_UNITS[e.target.value]?.[0]?.value || "pc" })}
                options={CATEGORIES}
                placeholder="Select category"
                searchPlaceholder="Search..."
              />
            </Field>
            <Field label="Base unit">
              <SearchableSelect
                value={form.base_unit}
                onChange={(e) => setForm({ ...form, base_unit: e.target.value })}
                options={BASE_UNITS[form.category] || BASE_UNITS.other}
                placeholder="Select base unit"
                searchPlaceholder="Search..."
              />
            </Field>
            <Field label="Conversion factor" hint="How many base units = 1 of this unit">
              <Input
                type="number"
                min="0"
                step="any"
                value={form.conversion_factor}
                onChange={(e) => setForm({ ...form, conversion_factor: e.target.value })}
                placeholder="1"
              />
            </Field>
          </div>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update Unit" : "Add Unit"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete unit?"
        message={`"${toDelete?.name}" (${toDelete?.short_name}) will be permanently removed.`}
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