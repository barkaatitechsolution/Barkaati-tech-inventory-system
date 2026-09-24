import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, Trash2, Package, AlertTriangle, Printer, ChevronLeft, ChevronRight, Image as ImageIcon, Upload, X } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney, fmtDate } from "../lib/format.js";
import { printProductCatalogue } from "../lib/receipt.js";
import { getStoreInfo } from "../lib/storeInfo.js";

const PAGE_SIZE = 20;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const finalPrice = (p) => {
  const base = Math.max((Number(p.selling_price) || 0) - (Number(p.discount) || 0), 0);
  return round2(base + (base * (Number(p.tax) || 0)) / 100);
};

const PRICE_FILTERS = [
  { value: "", label: "All prices" },
  { value: "missing", label: "No selling price" },
  { value: "set", label: "Has selling price" }
];

const EMPTY = {
  name: "",
  sku: "",
  category_id: "",
  subcategory_id: "",
  unit: "pcs",
  selling_price: "",
  market_price: "",
  discount: "",
  tax: "",
  reorder_level: "",
  hsn_code: "",
  expiry_date: "",
  description: "",
  images: [],
  newImages: []
};

export default function Products({ initialSearch = "", action, onActionConsumed }) {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState(initialSearch);
  const [catFilter, setCatFilter] = useState("");
  const [priceFilter, setPriceFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [removedIds, setRemovedIds] = useState([]);
  const [imageIdx, setImageIdx] = useState(0);
  const [toDelete, setToDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    if (action?.type === "product") {
      openCreate();
      onActionConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.nonce]);

  const load = async () => {
    setLoading(true);
    try {
      const [prod, cats, it] = await Promise.all([api.products(), api.categories(), api.items()]);
      setRows(prod);
      setCategories(cats);
      setItems(it);
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

  const subOptions = useMemo(() => {
    const cat = categories.find((c) => String(c.id) === String(form.category_id));
    return cat ? cat.subcategories : [];
  }, [categories, form.category_id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((p) => {
      const matchesQuery =
        !q ||
        [p.name, p.sku, p.category, p.subcategory, p.hsn_code]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      const matchesCat = !catFilter || String(p.category_id) === String(catFilter);
      const hasPrice = Number(p.selling_price) > 0;
      const matchesPrice = priceFilter === "" || (priceFilter === "missing" ? !hasPrice : hasPrice);
      return matchesQuery && matchesCat && matchesPrice;
    });
  }, [rows, search, catFilter, priceFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, catFilter, priceFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError(null);
    setRemovedIds([]);
    setImageIdx(0);
    setOpen(true);
  };

  const openEdit = (p) => {
    setEditing(p);
    setForm({
      name: p.name || "",
      sku: p.sku || "",
      category_id: p.category_id || "",
      subcategory_id: p.subcategory_id || "",
      unit: p.unit || "pcs",
      selling_price: p.selling_price ?? "",
      market_price: p.market_price ?? "",
      discount: p.discount ?? "",
      tax: p.tax ?? "",
      reorder_level: p.reorder_level ?? "",
      hsn_code: p.hsn_code || "",
      expiry_date: p.expiry_date ? p.expiry_date.slice(0, 10) : "",
      description: p.description || "",
      images: Array.isArray(p.images) ? p.images : [],
      newImages: []
    });
    setFormError(null);
    setRemovedIds([]);
    setImageIdx(0);
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      category_id: form.category_id || null,
      subcategory_id: form.subcategory_id || null,
      unit: form.unit || "pcs",
      selling_price: Number(form.selling_price) || 0,
      market_price: Number(form.market_price) || 0,
      discount: Number(form.discount) || 0,
      tax: Number(form.tax) || 0,
      reorder_level: Number(form.reorder_level) || 0,
      hsn_code: form.hsn_code.trim() || null,
      expiry_date: form.expiry_date || null,
      description: form.description.trim() || null
    };
    try {
      let message = "Product added";
      let productId = null;
      if (editing) {
        await api.updateProduct(editing.id, payload);
        productId = editing.id;
        message = "Product updated";
      } else {
        const res = await api.createProduct(payload);
        productId = res.id;
        if (res.updated) message = "Existing product updated";
      }
      if (productId != null) {
        if (removedIds.length > 0) await api.deleteProductImages(productId, removedIds);
        if (form.newImages.length > 0) {
          await api.uploadProductImages(
            productId,
            form.newImages.map((img) => ({ data_url: img.data_url }))
          );
        }
      }
      setOpen(false);
      setToast(message);
      setRemovedIds([]);
      setImageIdx(0);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteProduct(toDelete.id);
      setToDelete(null);
      setToast("Product deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  const visibleImages = form.images.filter((img) => !removedIds.includes(img.id));
  const combinedImages = [...visibleImages, ...form.newImages];
  const activeIndex = Math.min(imageIdx, Math.max(combinedImages.length - 1, 0));

  const onPickImages = (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        setForm((prev) => ({ ...prev, newImages: [...prev.newImages, { data_url: reader.result }] }));
      };
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  };

  const removeImage = (img) => {
    if (img.id != null) {
      setRemovedIds((prev) => (prev.includes(img.id) ? prev : [...prev, img.id]));
    } else {
      setForm((prev) => ({ ...prev, newImages: prev.newImages.filter((n) => n.data_url !== img.data_url) }));
    }
    const remaining = combinedImages.length - 1;
    if (activeIndex >= remaining) setImageIdx(Math.max(0, remaining - 1));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <SearchableSelect
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          placeholder="All categories"
          searchPlaceholder="Search categories..."
          className="w-full sm:w-48"
        />
        <SearchableSelect
          value={priceFilter}
          onChange={(e) => setPriceFilter(e.target.value)}
          options={PRICE_FILTERS}
          placeholder="All prices"
          searchPlaceholder="Search price filters..."
          className="w-full sm:w-48"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="soft"
            onClick={() => printProductCatalogue(getStoreInfo(), filtered)}
            disabled={loading || filtered.length === 0}
          >
            <Printer className="h-4 w-4" /> Print Catalogue
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Product
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
          <p className="p-5 text-sm text-rose-600">Failed to load products: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Package className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No products found</p>
            <p className="mt-1 text-sm text-slate-500">
              {search || catFilter || priceFilter
                ? "Try adjusting your search or filters."
                : "Add a product to start tracking stock."}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 sm:px-5">Item</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Category</th>
                    <th className="hidden px-3 py-3 sm:table-cell">HSN</th>
                    <th className="hidden px-3 py-3 text-right sm:table-cell">Cost</th>
                    <th className="px-3 py-3 text-right">
                      <span className="inline-flex items-center gap-1">
                        Selling Price
                        <span title="Selling price is important and must be set" className="text-rose-500">
                          *
                        </span>
                      </span>
                    </th>
                    <th className="hidden px-3 py-3 text-right sm:table-cell">Market</th>
                    <th className="hidden px-3 py-3 text-right sm:table-cell">Disc.</th>
                    <th className="hidden px-3 py-3 text-right sm:table-cell">Tax</th>
                    <th className="px-3 py-3 text-right">Final</th>
                    <th className="px-3 py-3 text-right">Stock</th>
                    <th className="hidden px-3 py-3 text-right sm:table-cell">Packs</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Expiry</th>
                    <th className="px-3 py-3 text-right sm:px-5">—</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => {
                    const low = Number(p.stock) <= Number(p.reorder_level);
                    return (
                      <tr key={p.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                        <td className="px-3 py-3 sm:px-5">
                          <div className="flex items-center gap-2">
                            {low && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                            {p.images && p.images.length > 0 ? (
                              <img
                                src={p.images[0].url}
                                alt=""
                                className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-white object-contain"
                              />
                            ) : (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                                <ImageIcon className="h-4 w-4" />
                              </div>
                            )}
                            <div>
                              <p className="font-semibold text-slate-800">{p.name}</p>
                              {p.sku && <p className="font-mono text-[11px] text-slate-400">{p.sku}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">
                          <p>{p.category || "—"}</p>
                          {p.subcategory && <p className="text-[11px] text-slate-400">{p.subcategory}</p>}
                        </td>
                        <td className="hidden px-3 py-3 font-mono text-xs text-slate-500 sm:table-cell">{p.hsn_code || "—"}</td>
                        <td className="hidden px-3 py-3 text-right text-slate-500 sm:table-cell">{fmtMoney(p.purchase_price)}</td>
                        <td className="px-3 py-3 text-right">
                          {Number(p.selling_price) > 0 ? (
                            <span className="font-semibold text-slate-700">{fmtMoney(p.selling_price)}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              <AlertTriangle className="h-3 w-3" /> Not set
                            </span>
                          )}
                        </td>
                        <td className="hidden px-3 py-3 text-right text-slate-500 sm:table-cell">
                          {Number(p.market_price) > 0 ? fmtMoney(p.market_price) : "—"}
                        </td>
                        <td className="hidden px-3 py-3 text-right text-slate-500 sm:table-cell">
                          {Number(p.discount) ? fmtMoney(p.discount) : "—"}
                        </td>
                        <td className="hidden px-3 py-3 text-right text-slate-500 sm:table-cell">{Number(p.tax) ? `${p.tax}%` : "—"}</td>
                        <td className="px-3 py-3 text-right font-bold text-slate-800">{fmtMoney(finalPrice(p))}</td>
                        <td className="px-3 py-3 text-right">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                              low ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {p.stock} {p.unit}
                          </span>
                        </td>
                        <td className="hidden px-3 py-3 text-right sm:table-cell">
                          {p.open_packs > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                              {p.open_packs} open
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="hidden px-3 py-3 text-xs text-slate-500 sm:table-cell">{p.expiry_date ? fmtDate(p.expiry_date) : "—"}</td>
                        <td className="px-3 py-3 text-right sm:px-5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(p)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                              aria-label="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setToDelete(p)}
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
              {pageRows.map((p) => {
                const low = Number(p.stock) <= Number(p.reorder_level);
                return (
                  <div key={p.id} className="flex items-start gap-3 px-4 py-3.5">
                    {p.images && p.images.length > 0 ? (
                      <img
                        src={p.images[0].url}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-white object-contain"
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-slate-800">{p.name}</p>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => openEdit(p)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setToDelete(p)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <p className="mt-0.5 truncate text-[11px] text-slate-400">
                        {[
                          p.sku,
                          p.category,
                          p.subcategory,
                          p.hsn_code ? `HSN ${p.hsn_code}` : ""
                        ].filter(Boolean).join(" · ") || "—"}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {low && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> Low stock
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            low ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {p.stock} {p.unit}
                        </span>
                        {Number(p.selling_price) > 0 ? (
                          <span className="text-[11px] text-slate-500">Sell {fmtMoney(p.selling_price)}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            Price not set
                          </span>
                        )}
                        {p.open_packs > 0 && (
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                            {p.open_packs} open packs
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-slate-100 pt-2">
                        <span className="text-[11px] text-slate-400">Final price</span>
                        <span className="text-base font-bold text-slate-800">{fmtMoney(finalPrice(p))}</span>
                      </div>

                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {[
                          `Cost ${fmtMoney(p.purchase_price)}`,
                          p.expiry_date ? `Exp ${fmtDate(p.expiry_date)}` : ""
                        ].filter(Boolean).join(" · ") || " "}
                      </p>
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
        title={editing ? "Edit Product" : "Add Product"}
        subtitle="Item details, pricing, taxes and stock"
        wide
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Select item" required className="sm:col-span-2">
              <Input
                list="product-items"
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  const norm = name.trim().toLowerCase().replace(/\s+/g, " ");
                  const match = rows.find((p) => !editing && p.name.trim().toLowerCase().replace(/\s+/g, " ") === norm);
                  if (match) {
                    setForm({
                      ...EMPTY,
                      name,
                      sku: match.sku || "",
                      category_id: match.category_id || "",
                      subcategory_id: match.subcategory_id || "",
                      unit: match.unit || "pcs",
                      purchase_price: match.purchase_price ?? "",
                      selling_price: match.selling_price ?? "",
                      market_price: match.market_price ?? "",
                      discount: match.discount ?? "",
                      tax: match.tax ?? "",
                      hsn_code: match.hsn_code || "",
                      description: match.description || "",
                      images: Array.isArray(match.images) ? match.images : []
                    });
                  } else {
                    setForm((f) => ({ ...f, name }));
                  }
                }}
                required
                placeholder="Type or select an item name"
              />
              <datalist id="product-items">
                {items.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </Field>

            <Field label="Category">
              <SearchableSelect
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value, subcategory_id: "" })}
                options={[{ value: "", label: "Select category" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                placeholder="Select category"
                searchPlaceholder="Search categories..."
              />
            </Field>
            <Field label="Sub category">
              <SearchableSelect
                value={form.subcategory_id}
                onChange={(e) => setForm({ ...form, subcategory_id: e.target.value })}
                options={[
                  { value: "", label: form.category_id ? "Select sub category" : "Select a category first" },
                  ...subOptions.map((s) => ({ value: s.id, label: s.name }))
                ]}
                placeholder={form.category_id ? "Select sub category" : "Select a category first"}
                searchPlaceholder="Search subcategories..."
                disabled={!form.category_id}
              />
            </Field>

            <Field label="SKU / code">
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. G-101" />
            </Field>
            <Field label="Unit">
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs / kg / pack" />
            </Field>

            <Field label="Selling price" required>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.selling_price}
                onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                required
                placeholder="0.00"
              />
            </Field>
            <Field label="Market price" hint="Retail/MRP for customer savings">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.market_price}
                onChange={(e) => setForm({ ...form, market_price: e.target.value })}
                placeholder="leave empty if same"
              />
            </Field>

            <Field label="Discount (amount)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Taxes (%)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.tax}
                onChange={(e) => setForm({ ...form, tax: e.target.value })}
                placeholder="e.g. 18"
              />
            </Field>
            <Field label="Reorder level">
              <Input
                type="number"
                min="0"
                step="1"
                value={form.reorder_level}
                onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                placeholder="0"
              />
            </Field>

            <Field label="HSN code">
              <Input value={form.hsn_code} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })} placeholder="e.g. 1006" />
            </Field>
            <Field label="Expiry date">
              <Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
            </Field>
            <Field label="Final price" hint="Selling price − discount + tax">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-indigo-600">
                {fmtMoney(finalPrice(form))}
              </div>
            </Field>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Photos</p>
                <p className="text-[11px] text-slate-400">Add several photos — they show in a slider</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">
                <Upload className="h-3.5 w-3.5" /> Add Photos
                <input type="file" accept="image/*" multiple className="hidden" onChange={onPickImages} />
              </label>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="relative flex h-56 items-center justify-center bg-slate-50">
                {combinedImages.length > 0 ? (
                  <img
                    src={combinedImages[activeIndex].url || combinedImages[activeIndex].data_url}
                    alt=""
                    className="max-h-56 w-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center text-slate-400">
                    <ImageIcon className="h-9 w-9" />
                    <p className="mt-2 text-xs">No photos yet — click Add Photos</p>
                  </div>
                )}

                {combinedImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setImageIdx((activeIndex - 1 + combinedImages.length) % combinedImages.length)}
                      className="absolute left-2 rounded-full bg-white/90 p-1.5 text-slate-600 shadow ring-1 ring-slate-200 transition hover:bg-white"
                      aria-label="Previous photo"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageIdx((activeIndex + 1) % combinedImages.length)}
                      className="absolute right-2 rounded-full bg-white/90 p-1.5 text-slate-600 shadow ring-1 ring-slate-200 transition hover:bg-white"
                      aria-label="Next photo"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <span className="absolute right-2 top-2 rounded-full bg-slate-900/70 px-2 py-0.5 text-[11px] font-semibold text-white">
                      {activeIndex + 1} / {combinedImages.length}
                    </span>
                  </>
                )}
              </div>

              {combinedImages.length > 0 && (
                <div className="flex gap-2 overflow-x-auto p-2 scrollbar-thin">
                  {combinedImages.map((img, i) => (
                    <div key={img.id != null ? img.id : img.data_url} className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setImageIdx(i)}
                        className={`block h-14 w-14 overflow-hidden rounded-xl border-2 transition ${
                          i === activeIndex ? "border-indigo-500" : "border-transparent"
                        }`}
                      >
                        <img
                          src={img.url || img.data_url}
                          alt=""
                          className="h-full w-full bg-white object-contain"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeImage(img)}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-500 p-0.5 text-white shadow transition hover:bg-rose-600"
                        aria-label="Remove photo"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Product description…"
            />
          </Field>

          {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update Product" : "Add Product"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete product?"
        message={`"${toDelete?.name}" will be permanently removed from inventory.`}
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