import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Boxes, Pencil, Trash2, MapPin, Calendar } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney, fmtDate } from "../lib/format.js";

const PAGE_SIZE = 20;

const CATEGORIES = ["Equipment", "Furniture", "Vehicle", "Electronics", "Building", "Other"].map((c) => ({
  value: c,
  label: c
}));
const CONDITIONS = ["Excellent", "Good", "Fair", "Poor", "Retired"].map((c) => ({ value: c, label: c }));

const EMPTY = {
  name: "",
  category: "Equipment",
  purchase_date: "",
  purchase_cost: "",
  current_value: "",
  condition: "Good",
  location: "",
  note: ""
};

export default function Assets() {
  const [rows, setRows] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatSaving, setNewCatSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [assetRows, categoryRows] = await Promise.all([api.assets(), api.assetCategories()]);
      setRows(assetRows);
      setCats(categoryRows);
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
    return rows.filter((a) => {
      const matchesQuery =
        !q ||
        [a.name, a.category, a.location, a.note]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      const matchesCat = !catFilter || a.category === catFilter;
      return matchesQuery && matchesCat;
    });
  }, [rows, search, catFilter]);

  const catOptions = useMemo(() => {
    const map = new Map();
    const push = (name) => {
      const n = String(name || "").trim();
      if (n && !map.has(n)) map.set(n, { value: n, label: n });
    };
    CATEGORIES.forEach((o) => push(o.value));
    cats.forEach((c) => push(c.name));
    rows.forEach((r) => push(r.category));
    return [...map.values()];
  }, [cats, rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, catFilter]);

  const stats = useMemo(() => {
    const totalCost = rows.reduce((a, r) => a + (Number(r.purchase_cost) || 0), 0);
    const totalValue = rows.reduce((a, r) => a + (Number(r.current_value) || 0), 0);
    return { totalCost, totalValue, count: rows.length };
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (a) => {
    setEditing(a);
    setForm({
      name: a.name || "",
      category: a.category || "Equipment",
      purchase_date: a.purchase_date ? a.purchase_date.slice(0, 10) : "",
      purchase_cost: a.purchase_cost ?? "",
      current_value: a.current_value ?? "",
      condition: a.condition || "Good",
      location: a.location || "",
      note: a.note || ""
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
      category: form.category,
      purchase_date: form.purchase_date || null,
      purchase_cost: Number(form.purchase_cost) || 0,
      current_value: Number(form.current_value) || Number(form.purchase_cost) || 0,
      condition: form.condition,
      location: form.location.trim() || null,
      note: form.note.trim() || null
    };
    try {
      if (editing) await api.updateAsset(editing.id, payload);
      else await api.createAsset(payload);
      setOpen(false);
      setToast(editing ? "Asset updated" : "Asset added");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteAsset(toDelete.id);
      setToDelete(null);
      setToast("Asset deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  const condColor = (c) => {
    const map = {
      Excellent: "bg-emerald-50 text-emerald-700",
      Good: "bg-blue-50 text-blue-700",
      Fair: "bg-amber-50 text-amber-700",
      Poor: "bg-orange-50 text-orange-700",
      Retired: "bg-slate-100 text-slate-600"
    };
    return map[c] || "bg-slate-100 text-slate-600";
  };

  const createCat = async () => {
    const name = newCatName.trim();
    if (!name) return;
    setNewCatSaving(true);
    setFormError(null);
    try {
      await api.createAssetCategory({ name });
      setCats(await api.assetCategories());
      setForm({ ...form, category: name });
      setNewCatOpen(false);
      setNewCatName("");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setNewCatSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total Assets</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{stats.count}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Purchase Cost</p>
          <p className="mt-1 text-xl font-bold text-slate-800">{fmtMoney(stats.totalCost)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Current Value</p>
          <p className={`mt-1 text-xl font-bold ${stats.totalValue >= stats.totalCost ? "text-emerald-600" : "text-amber-600"}`}>
            {fmtMoney(stats.totalValue)}
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <SearchableSelect
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          options={[{ value: "", label: "All categories" }, ...catOptions]}
          placeholder="All categories"
          searchPlaceholder="Search categories..."
          className="w-full sm:w-48"
        />
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Asset
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
          <p className="p-5 text-sm text-rose-600">Failed to load assets: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Boxes className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No assets found</p>
            <p className="mt-1 text-sm text-slate-500">Add an asset to track equipment and property.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 sm:px-5">Asset</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Category</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Condition</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Location</th>
                    <th className="px-3 py-3 text-right">Cost</th>
                    <th className="px-3 py-3 text-right">Value</th>
                    <th className="px-3 py-3 text-right sm:px-5">—</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((a) => (
                    <tr key={a.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                      <td className="px-3 py-3 sm:px-5">
                        <div>
                          <p className="font-semibold text-slate-800">{a.name}</p>
                          {a.purchase_date && (
                            <p className="flex items-center gap-1 text-[11px] text-slate-400">
                              <Calendar className="h-3 w-3" /> {fmtDate(a.purchase_date)}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">{a.category}</td>
                      <td className="hidden px-3 py-3 sm:table-cell">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${condColor(a.condition)}`}>
                          {a.condition}
                        </span>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">
                        {a.location ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-slate-400" /> {a.location}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">{fmtMoney(a.purchase_cost)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-800">{fmtMoney(a.current_value)}</td>
                      <td className="px-3 py-3 text-right sm:px-5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(a)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setToDelete(a)}
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

            <div className="divide-y divide-slate-100 sm:hidden">
              {pageRows.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-semibold text-slate-800">{a.name}</p>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => openEdit(a)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(a)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <p className="truncate text-[11px] text-slate-400">
                      {[
                        a.category,
                        a.location,
                        a.purchase_date ? fmtDate(a.purchase_date) : ""
                      ].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                      <span className="text-[11px] text-slate-400">Cost {fmtMoney(a.purchase_cost)}</span>
                      <span className="text-xs font-semibold text-slate-800">
                        <span className="font-normal text-slate-400">Value </span>
                        {fmtMoney(a.current_value)}
                      </span>
                    </div>
                  </div>
                  <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${condColor(a.condition)}`}>
                    {a.condition}
                  </span>
                </div>
              ))}
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
        title={editing ? "Edit Asset" : "Add Asset"}
        subtitle="Asset details and value"
      >
        <form onSubmit={save} className="space-y-4">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="e.g. Office Printer"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <SearchableSelect
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    options={catOptions}
                    placeholder="Select category"
                    searchPlaceholder="Search categories..."
                  />
                </div>
                <Button
                  type="button"
                  variant="soft"
                  className="h-[42px] shrink-0 px-3"
                  onClick={() => setNewCatOpen(true)}
                  aria-label="Create category"
                  title="Create new category"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {newCatOpen && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        createCat();
                      }
                    }}
                    placeholder="New category name"
                    autoFocus
                    disabled={newCatSaving}
                  />
                  <Button type="button" onClick={createCat} disabled={!newCatName.trim() || newCatSaving} className="shrink-0">
                    {newCatSaving ? "Adding…" : "Add"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      setNewCatOpen(false);
                      setNewCatName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </Field>
            <Field label="Condition">
              <SearchableSelect
                value={form.condition}
                onChange={(e) => setForm({ ...form, condition: e.target.value })}
                options={CONDITIONS}
                placeholder="Select condition"
                searchPlaceholder="Search conditions..."
              />
            </Field>
            <Field label="Purchase date">
              <Input
                type="date"
                value={form.purchase_date}
                onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
              />
            </Field>
            <Field label="Location">
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Main Office"
              />
            </Field>
            <Field label="Purchase cost">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.purchase_cost}
                onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Current value">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.current_value}
                onChange={(e) => setForm({ ...form, current_value: e.target.value })}
                placeholder="0.00"
              />
            </Field>
          </div>
          <Field label="Note">
            <Textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Additional details…"
            />
          </Field>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update Asset" : "Add Asset"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete asset?"
        message={`"${toDelete?.name}" will be permanently removed from the register.`}
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