import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, Trash2, Tags, Package, Layers, X, Boxes, Star } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { StarDisplay, StarInput } from "../components/StarRating.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";

const PAGE_SIZE = 12;

const EMPTY = { name: "", description: "", quality_stars: 0, subcategories: [] };

const CHIP_COLORS = [
  "bg-indigo-50 text-indigo-600",
  "bg-amber-50 text-amber-600",
  "bg-emerald-50 text-emerald-600",
  "bg-rose-50 text-rose-500",
  "bg-sky-50 text-sky-600"
];

const SORT_OPTIONS = [
  { value: "name", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "rating", label: "Top rated" },
  { value: "products", label: "Most products" }
];

const STAR_OPTIONS = [
  { value: "", label: "All ratings" },
  { value: "top", label: "Top rated (4★+)" },
  { value: "unrated", label: "Not rated" },
  { value: "rated", label: "Has rating" }
];

export default function Categories() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [starFilter, setStarFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.categories());
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
    return rows.filter((c) => {
      const matchesQuery =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q) ||
        c.subcategories.some((s) => s.name.toLowerCase().includes(q));
      const matchesStars =
        starFilter === "" ||
        (starFilter === "top" && c.quality_stars >= 4) ||
        (starFilter === "rated" && c.quality_stars > 0) ||
        (starFilter === "unrated" && !c.quality_stars);
      return matchesQuery && matchesStars;
    });
  }, [rows, search, starFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === "name-desc") arr.sort((a, b) => b.name.localeCompare(a.name));
    else if (sort === "rating") arr.sort((a, b) => b.quality_stars - a.quality_stars || a.name.localeCompare(b.name));
    else if (sort === "products") arr.sort((a, b) => Number(b.product_count) - Number(a.product_count) || a.name.localeCompare(b.name));
    else arr.sort((a, b) => a.name.localeCompare(b.name));
    return arr;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, sort, starFilter]);

  const stats = useMemo(() => {
    const subTotal = rows.reduce((a, c) => a + c.subcategories.length, 0);
    const prodTotal = rows.reduce((a, c) => a + (Number(c.product_count) || 0), 0);
    const rated = rows.filter((c) => c.quality_stars > 0).length;
    return { categories: rows.length, subTotal, prodTotal, rated };
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, subcategories: [{ name: "" }] });
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (cat) => {
    setEditing(cat);
    setForm({
      name: cat.name,
      description: cat.description || "",
      quality_stars: cat.quality_stars || 0,
      subcategories: cat.subcategories.length ? cat.subcategories.map((s) => ({ id: s.id, name: s.name })) : [{ name: "" }]
    });
    setFormError(null);
    setOpen(true);
  };

  const setSub = (i, value) => {
    setForm((f) => {
      const subs = [...f.subcategories];
      subs[i] = { ...subs[i], name: value };
      return { ...f, subcategories: subs };
    });
  };
  const addSub = () => setForm((f) => ({ ...f, subcategories: [...f.subcategories, { name: "" }] }));
  const removeSub = (i) =>
    setForm((f) => ({ ...f, subcategories: f.subcategories.filter((_, idx) => idx !== i) }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Category name is required");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      quality_stars: form.quality_stars,
      subcategories: form.subcategories.map((s) => (s.id ? { id: s.id, name: s.name.trim() } : s.name.trim())).filter(Boolean)
    };
    try {
      if (editing) await api.updateCategory(editing.id, payload);
      else await api.createCategory(payload);
      setOpen(false);
      setToast(editing ? "Category updated" : "Category created");
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteCategory(toDelete.id);
      setToDelete(null);
      setToast("Category deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Categories", value: stats.categories, icon: Tags, color: "text-indigo-600" },
          { label: "Sub categories", value: stats.subTotal, icon: Layers, color: "text-emerald-600" },
          { label: "Products", value: stats.prodTotal, icon: Package, color: "text-amber-600" },
          { label: "Rated categories", value: stats.rated, icon: Star, color: "text-rose-500" }
        ].map((s) => (
          <Card key={s.label} className="!p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{s.label}</p>
                <p className={`mt-1 text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
              <s.icon className={`h-5 w-5 shrink-0 ${s.color}`} />
            </div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search categories, sub categories…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <SearchableSelect
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          options={SORT_OPTIONS}
          placeholder="Sort"
          searchPlaceholder="Search options..."
          className="w-full sm:w-44"
        />
        <SearchableSelect
          value={starFilter}
          onChange={(e) => setStarFilter(e.target.value)}
          options={STAR_OPTIONS}
          placeholder="All ratings"
          searchPlaceholder="Search ratings..."
          className="w-full sm:w-44"
        />
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Category
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200/70" />
          ))}
        </div>
      ) : error ? (
        <Card className="text-sm text-rose-600">Failed to load categories: {error}</Card>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Boxes className="h-7 w-7" />
          </div>
          <p className="mt-4 font-semibold text-slate-900">
            {search || starFilter ? "No categories match" : "No categories yet"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {search || starFilter ? "Try adjusting your search or filters." : "Create a category to start organising your products."}
          </p>
          {!search && !starFilter && (
            <Button className="mt-5" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Category
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {pageRows.map((cat, idx) => {
            const isExpanded = expanded === cat.id;
            const visibleSubs = isExpanded ? cat.subcategories : cat.subcategories.slice(0, 4);
            return (
              <Card
                key={cat.id}
                className="group animate-fade-up flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/70"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                        CHIP_COLORS[idx % CHIP_COLORS.length]
                      }`}
                    >
                      <Tags className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-bold text-slate-900">{cat.name}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {cat.quality_stars > 0 ? (
                          <>
                            <StarDisplay value={cat.quality_stars} size="h-3.5 w-3.5" />
                            {cat.quality_stars >= 4 && (
                              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                                Top rated
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] font-medium text-slate-400">Not rated</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => openEdit(cat)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setToDelete(cat)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <p className="mt-3 line-clamp-2 flex-1 text-sm text-slate-500">
                  {cat.description || "No description added."}
                </p>

                {cat.subcategories.length > 0 ? (
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {visibleSubs.map((s) => (
                        <span
                          key={s.id}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-indigo-50 hover:text-indigo-600"
                        >
                          {s.name}
                        </span>
                      ))}
                      {!isExpanded && cat.subcategories.length > 4 && (
                        <button
                          type="button"
                          onClick={() => setExpanded(cat.id)}
                          className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 transition hover:bg-indigo-100"
                        >
                          +{cat.subcategories.length - 4} more
                        </button>
                      )}
                      {isExpanded && (
                        <button
                          type="button"
                          onClick={() => setExpanded(null)}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-200"
                        >
                          Show less
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">No sub categories.</p>
                )}

                <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    <span>
                      <span className="font-semibold text-slate-600">{cat.product_count}</span> product
                      {cat.product_count === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    <span>
                      <span className="font-semibold text-slate-600">{cat.subcategories.length}</span> sub
                    </span>
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <Card className="!p-0">
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={sorted.length} onChange={setPage} />
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Category" : "Add Category"}
        subtitle="Group your products with sub-categories and a quality rating"
        wide
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Groceries" />
            </Field>
            <Field label="Quality stars">
              <StarInput value={form.quality_stars} onChange={(v) => setForm({ ...form, quality_stars: v })} />
            </Field>
          </div>

          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Short description of this category…"
            />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Sub categories</span>
              <button type="button" onClick={addSub} className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-100">
                + Add sub category
              </button>
            </div>
            <div className="space-y-2">
              {form.subcategories.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={s.name}
                    onChange={(e) => setSub(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addSub();
                      }
                    }}
                    placeholder={`Sub category ${i + 1}`}
                    autoFocus={i === form.subcategories.length - 1}
                  />
                  <button
                    type="button"
                    onClick={() => removeSub(i)}
                    className="rounded-lg border border-slate-200 p-2.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Remove"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {form.subcategories.length === 0 && (
                <p className="text-xs text-slate-400">No sub categories yet — press the button above to add one.</p>
              )}
              {form.subcategories.length > 0 && (
                <p className="text-[11px] text-slate-400">Press Enter while typing to add another.</p>
              )}
            </div>
          </div>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update Category" : "Create Category"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete category?"
        message={`"${toDelete?.name}" will be removed. Products keep their record but lose this category.`}
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