import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Package, Pencil, Plus, ScanLine, Search, Trash2, X } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtMoney } from "../lib/format.js";
import { scanBarcode } from "../lib/scanner.js";
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
  cx,
  showToast
} from "../components/ui.jsx";

const blank = {
  name: "",
  sku: "",
  barcode: "",
  unit: "pcs",
  unit_id: "",
  category_id: "",
  subcategory_id: "",
  selling_price: "",
  market_price: "",
  purchase_price: "",
  tax: "",
  discount: "",
  hsn_code: "",
  description: "",
  reorder_level: "",
  stock: "",
  online: true
};

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function ProductForm({ open, product, onClose, onSaved }) {
  const [form, setForm] = useState(blank);
  const [images, setImages] = useState([]);
  const [existing, setExisting] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const categories = useAsync(() => api.categories(), []);
  const units = useAsync(() => api.measuringUnits(), []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (!open) return;
    if (product) {
      setForm({
        ...blank,
        ...product,
        category_id: product.category_id || "",
        subcategory_id: product.subcategory_id || "",
        unit_id: product.unit_id || "",
        online: !!product.online
      });
      setExisting(product.images || []);
    } else {
      setForm(blank);
      setExisting([]);
    }
    setImages([]);
    setError("");
  }, [open, product]);

  const subs = (categories.data || []).find((c) => String(c.id) === String(form.category_id))?.subcategories || [];

  const scan = async () => {
    try {
      const code = await scanBarcode();
      setForm((f) => ({ ...f, barcode: code }));
    } catch (e) {
      showToast(e?.message || "Scan failed", "error");
    }
  };

  const addImages = async (files) => {
    const list = [];
    for (const file of files) {
      try {
        list.push(await readFile(file));
      } catch {
        /* skip */
      }
    }
    setImages((prev) => [...prev, ...list]);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setError("Product name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        selling_price: Number(form.selling_price) || 0,
        market_price: Number(form.market_price) || 0,
        purchase_price: Number(form.purchase_price) || 0,
        tax: Number(form.tax) || 0,
        discount: Number(form.discount) || 0,
        reorder_level: Number(form.reorder_level) || 0,
        stock: Number(form.stock) || 0,
        category_id: form.category_id || null,
        subcategory_id: form.subcategory_id || null,
        unit_id: form.unit_id || null
      };
      let saved;
      if (product) {
        saved = await api.updateProduct(product.id, payload);
        if (images.length) await api.uploadProductImages(product.id, images.map((url) => ({ url })));
      } else {
        saved = await api.createProduct({ ...payload, images: images.map((url) => ({ url })) });
      }
      showToast(product ? "Product updated" : "Product added");
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e?.message || "Could not save the product");
    } finally {
      setSaving(false);
    }
  };

  const removeExisting = async (image) => {
    if (!product) return;
    await api.deleteProductImages(product.id, [image.id]);
    setExisting((prev) => prev.filter((i) => i.id !== image.id));
  };

  return (
    <Modal
      open={open}
      title={product ? "Edit product" : "New product"}
      onClose={onClose}
      wide
      footer={
        <Button className="w-full" size="lg" loading={saving} onClick={save}>
          {product ? "Save changes" : "Add product"}
        </Button>
      }
    >
      <div className="space-y-3">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}
        <Field label="Product name">
          <Input value={form.name} onChange={set("name")} placeholder="e.g. Turmeric powder 100g" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="SKU">
            <Input value={form.sku} onChange={set("sku")} placeholder="Optional" />
          </Field>
          <Field label="Barcode">
            <div className="flex gap-1">
              <Input value={form.barcode} onChange={set("barcode")} placeholder="Optional" />
              <IconButton onClick={scan} className="h-11 w-11 shrink-0 bg-slate-100" aria-label="Scan">
                <ScanLine className="h-4 w-4" />
              </IconButton>
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Category">
            <Select value={form.category_id} onChange={set("category_id")}>
              <option value="">None</option>
              {(categories.data || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subcategory">
            <Select value={form.subcategory_id} onChange={set("subcategory_id")} disabled={!subs.length}>
              <option value="">None</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Selling (Rs)">
            <Input value={form.selling_price} onChange={set("selling_price")} inputMode="decimal" />
          </Field>
          <Field label="Market (Rs)">
            <Input value={form.market_price} onChange={set("market_price")} inputMode="decimal" />
          </Field>
          <Field label="Cost (Rs)">
            <Input value={form.purchase_price} onChange={set("purchase_price")} inputMode="decimal" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Stock">
            <Input value={form.stock} onChange={set("stock")} inputMode="decimal" />
          </Field>
          <Field label="Reorder at">
            <Input value={form.reorder_level} onChange={set("reorder_level")} inputMode="decimal" />
          </Field>
          <Field label="Tax %">
            <Input value={form.tax} onChange={set("tax")} inputMode="decimal" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Unit">
            <Select value={form.unit_id} onChange={set("unit_id")}>
              <option value="">{form.unit || "pcs"}</option>
              {(units.data || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="HSN code">
            <Input value={form.hsn_code} onChange={set("hsn_code")} placeholder="Optional" />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={form.description} onChange={set("description")} rows={2} placeholder="Optional" />
        </Field>

        <Field label="Photos">
          <div className="flex flex-wrap gap-2">
            {existing.map((img) => (
              <div key={img.id} className="relative h-20 w-20 overflow-hidden rounded-xl bg-slate-100">
                <img src={img.url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeExisting(img)}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-1 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {images.map((url, i) => (
              <div key={i} className="relative h-20 w-20 overflow-hidden rounded-xl bg-slate-100">
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-1 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-400"
            >
              <ImagePlus className="h-5 w-5" />
              <span className="text-[10px] font-medium">Add</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addImages([...(e.target.files || [])]);
                e.target.value = "";
              }}
            />
          </div>
        </Field>

        <label className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="text-sm font-medium text-slate-700">Show in online store</span>
          <input
            type="checkbox"
            checked={!!form.online}
            onChange={(e) => setForm((f) => ({ ...f, online: e.target.checked }))}
            className="h-5 w-5 accent-brand-700"
          />
        </label>
      </div>
    </Modal>
  );
}

export default function Products() {
  const { version, bump } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data, loading, error, reload } = useAsync(
    () => api.products({ q: query, limit: 300, price: filter === "missing" ? "missing" : undefined }),
    [query, version]
  );

  const list = useMemo(() => {
    const rows = data || [];
    if (filter === "low") return rows.filter((p) => Number(p.reorder_level) > 0 && Number(p.stock) <= Number(p.reorder_level));
    if (filter === "out") return rows.filter((p) => Number(p.stock) <= 0);
    return rows;
  }, [data, filter]);

  const remove = async () => {
    try {
      await api.deleteProduct(deleting.id);
      showToast("Product deleted");
      setDeleting(null);
      bump();
      reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Products"
        subtitle={`${list.length} item${list.length === 1 ? "" : "s"}`}
        right={
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />

      <div className="px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" className="pl-9" />
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          {[
            ["all", "All"],
            ["low", "Low stock"],
            ["out", "Out of stock"],
            ["missing", "No price"]
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cx(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                filter === key ? "bg-brand-700 text-white" : "bg-white text-slate-600"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 px-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-brand-600" />
          </div>
        ) : error ? (
          <Card className="border border-red-100 bg-red-50">
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        ) : list.length ? (
          <div className="space-y-2">
            {list.map((p) => (
              <Card key={p.id} className="flex items-center gap-3 p-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                  {p.images?.[0]?.url ? (
                    <img src={p.images[0].url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-300">
                      <Package className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {p.category || "Uncategorised"}
                    {p.barcode ? ` · ${p.barcode}` : ""}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-bold text-brand-700">{fmtMoney(p.selling_price)}</span>
                    <Badge
                      tone={
                        Number(p.stock) <= 0
                          ? "red"
                          : Number(p.reorder_level) > 0 && Number(p.stock) <= Number(p.reorder_level)
                          ? "amber"
                          : "green"
                      }
                    >
                      {Number(p.stock)} {p.unit || "pcs"}
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <IconButton
                    onClick={() => { setEditing(p); setFormOpen(true); }}
                    className="h-8 w-8 bg-slate-100"
                    aria-label="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    onClick={() => setDeleting(p)}
                    className="h-8 w-8 bg-red-50 text-red-500"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty
            icon={Package}
            title="No products found"
            description={query ? "Try a different search." : "Add your first product to start selling."}
            action={<Button onClick={() => { setEditing(null); setFormOpen(true); }}>Add product</Button>}
          />
        )}
      </div>

      <ProductForm
        open={formOpen}
        product={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => { bump(); reload(); }}
      />

      <Confirm
        open={!!deleting}
        title="Delete product?"
        message={`"${deleting?.name || ""}" will be removed. Past bills keep their copy of the name and price.`}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </div>
  );
}
