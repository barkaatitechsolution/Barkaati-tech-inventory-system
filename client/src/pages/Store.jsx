import { useEffect, useMemo, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import {
  Search,
  ShoppingCart,
  Package,
  Plus,
  Minus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Store as StoreIcon,
  X,
  Phone,
  MapPin,
  CheckCircle2,
  ShoppingBag
} from "lucide-react";
import { api } from "../api.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { fmtMoney } from "../lib/format.js";
import { Field, Input, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";

const finalPrice = (p) => {
  const sp = Number(p.selling_price) || 0;
  const disc = Number(p.discount) || 0;
  const tax = Number(p.tax) || 0;
  const taxable = Math.max(0, sp - disc);
  return Math.round((taxable + (taxable * tax) / 100) * 100) / 100;
};

const stockTone = (p) => {
  const stock = Number(p.stock) || 0;
  if (stock <= 0) return { label: "Out of stock", cls: "bg-rose-50 text-rose-600" };
  const low = Number(p.reorder_level) > 0 ? Number(p.reorder_level) : 5;
  if (stock <= low) return { label: "Low stock", cls: "bg-amber-50 text-amber-600" };
  return { label: "In stock", cls: "bg-emerald-50 text-emerald-600" };
};

export default function Store() {
  const store = getStoreInfo();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [category, setCategory] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [cart, setCart] = useState([]);
  const [imgIdx, setImgIdx] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "", note: "" });
  const [formError, setFormError] = useState(null);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([api.productOptions(), api.categories()]);
      setProducts(p);
      setCategories(c);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const inCart = (id) => cart.find((i) => i.id === id);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return products.filter((p) => {
      const matchesQuery =
        !q ||
        [p.name, p.sku, p.category]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      const matchesCat = !category || String(p.category_id) === String(category);
      const matchesStock = !inStockOnly || Number(p.stock) > 0;
      return matchesQuery && matchesCat && matchesStock;
    });
  }, [products, debouncedSearch, category, inStockOnly]);

  const categoryOptions = [
    { value: "", label: "All categories" },
    ...categories.map((c) => ({ value: c.id, label: c.name }))
  ];

  const subtotal = cart.reduce((a, i) => a + finalPrice(i) * i.qty, 0);
  const cartCount = cart.reduce((a, i) => a + i.qty, 0);

  const addToCart = (p) => {
    const existing = inCart(p.id);
    if (existing) {
      if (existing.qty >= Number(p.stock) || 0) return;
      setCart(cart.map((i) => (i.id === p.id ? { ...i, qty: i.qty + 1 } : i)));
    } else {
      setCart([...cart, { ...p, qty: 1 }]);
    }
  };

  const setQty = (id, qty) => {
    setCart(
      cart.map((i) => {
        if (i.id !== id) return i;
        const max = Math.max(0, Number(i.stock) || 0);
        return { ...i, qty: Math.min(Math.max(1, qty), max || 1) };
      })
    );
  };

  const removeFromCart = (id) => setCart(cart.filter((i) => i.id !== id));

  const slide = (id, len, dir) => {
    const cur = imgIdx[id] || 0;
    setImgIdx({ ...imgIdx, [id]: (cur + dir + len) % len });
  };

  const placeOrder = async () => {
    const name = form.name.trim();
    const phone = form.phone.trim();
    const address = form.address.trim();
    if (!name && !phone) {
      setFormError("Please enter your name or phone so we can confirm the order");
      return;
    }
    setPlacing(true);
    setFormError(null);
    try {
      const customers = await api.customers();
      const norm = (v) => String(v || "").replace(/[\s-]/g, "").toLowerCase();
      let customerId = null;
      const existing =
        (phone &&
          customers.find((c) => c.phone && norm(c.phone) === norm(phone))) ||
        (name && customers.find((c) => c.name.toLowerCase() === name.toLowerCase()));
      if (existing) {
        customerId = existing.id;
      } else if (name || phone) {
        const created = await api.createCustomer({
          name: name || "Online customer",
          phone: phone || null,
          address: address || null
        });
        customerId = created.id;
      }
      const noteParts = [`Online order — ${name || "Walk-in online"}`];
      if (phone) noteParts.push(phone);
      if (address) noteParts.push(address);
      const res = await api.createSale({
        customer_id: customerId,
        items: cart.map((i) => ({ product_id: i.id, qty: i.qty })),
        status: "booking",
        payment_method: "online",
        note: noteParts.join(" · ")
      });
      setPlaced(res);
      setCart([]);
      setCartOpen(false);
      setForm({ name: "", phone: "", address: "", note: "" });
      await loadProducts();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Order Online</p>
            <p className="text-xs text-slate-500">
              {store.name}
              {store.phone ? ` · Ph: ${store.phone}` : ""}
            </p>
          </div>
        </div>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <SearchableSelect
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={categoryOptions}
          placeholder="All categories"
          searchPlaceholder="Search categories..."
          className="w-full sm:w-44"
        />
        <label className="flex cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => setInStockOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          In stock only
        </label>
        <button
          onClick={() => setCartOpen(true)}
          className="relative inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <ShoppingCart className="h-4 w-4" /> Cart
          {cartCount > 0 && (
            <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-bold text-white">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <div key={i} className="h-60 animate-pulse rounded-2xl bg-white/80 ring-1 ring-slate-200/60" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">Failed to load products: {error}</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Package className="h-7 w-7" />
          </div>
          <p className="mt-4 font-semibold text-slate-900">No products found</p>
          <p className="mt-1 text-sm text-slate-500">Try a different search or category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((p) => {
            const images = Array.isArray(p.images) ? p.images : [];
            const cur = imgIdx[p.id] || 0;
            const price = finalPrice(p);
            const market = Number(p.market_price) || 0;
            const save = market > price ? market - price : 0;
            const tone = stockTone(p);
            const citem = inCart(p.id);
            const maxStock = Number(p.stock) || 0;
            return (
              <div key={p.id} className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 transition hover:shadow-md">
                <div className="group relative flex h-40 items-center justify-center bg-slate-50 sm:h-44">
                  {images.length > 0 ? (
                  <img
                    src={images[cur % images.length].url}
                    alt={p.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center text-slate-300">
                      <ImageIcon className="h-10 w-10" />
                      <p className="mt-1 text-[10px] font-medium">No photo</p>
                    </div>
                  )}
                  {images.length > 1 && (
                    <>
                      <button
                        onClick={() => slide(p.id, images.length, -1)}
                        className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1 text-slate-600 shadow ring-1 ring-slate-200 hover:bg-white"
                        aria-label="Previous photo"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => slide(p.id, images.length, 1)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-1 text-slate-600 shadow ring-1 ring-slate-200 hover:bg-white"
                        aria-label="Next photo"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-1">
                        {images.map((_, i) => (
                          <span
                            key={i}
                            className={`h-1.5 w-1.5 rounded-full ${i === cur % images.length ? "bg-indigo-500" : "bg-white/80 ring-1 ring-slate-300"}`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  {save > 0 && (
                    <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      Save {fmtMoney(save)}
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-slate-800">{p.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {p.unit || "pcs"}
                    {p.sku ? ` · ${p.sku}` : ""}
                  </p>
                  <div className="flex items-baseline gap-1.5">
                    <p className="text-base font-bold text-indigo-700">{fmtMoney(price)}</p>
                    {market > price && (
                      <p className="text-xs text-slate-400 line-through">{fmtMoney(market)}</p>
                    )}
                  </div>
                  <p className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.cls}`}>
                    {tone.label}
                  </p>
                  <div className="mt-auto pt-2">
                    {maxStock <= 0 ? (
                      <div className="rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-400">
                        Out of stock
                      </div>
                    ) : citem ? (
                      <div className="flex items-center justify-between rounded-xl bg-indigo-50 px-2 py-1.5 ring-1 ring-indigo-100">
                        <button
                          onClick={() => setQty(p.id, citem.qty - 1)}
                          className="rounded-lg p-1 text-indigo-600 transition hover:bg-white"
                          aria-label="Decrease"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="text-sm font-bold text-indigo-700">{citem.qty}</span>
                        <button
                          onClick={() => setQty(p.id, citem.qty + 1)}
                          disabled={citem.qty >= maxStock}
                          className="rounded-lg p-1 text-indigo-600 transition hover:bg-white disabled:opacity-30"
                          aria-label="Increase"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <Button onClick={() => addToCart(p)} className="w-full !py-2 text-xs">
                        <Plus className="h-3.5 w-3.5" /> Add to cart
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <div className="relative flex h-full w-full max-w-md flex-col bg-slate-50 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-indigo-600" />
                <p className="font-bold text-slate-900">Your order</p>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
                  {cartCount} item{cartCount === 1 ? "" : "s"}
                </span>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close cart"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-400">
                  <ShoppingBag className="h-8 w-8" />
                </div>
                <p className="font-semibold text-slate-700">Your cart is empty</p>
                <p className="max-w-[220px] text-xs text-slate-500">Browse products and add items to book an order.</p>
              </div>
            ) : (
              <>
                <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
                  {cart.map((i) => {
                    const images = Array.isArray(i.images) ? i.images : [];
                    return (
                      <div key={i.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                          {images.length > 0 ? (
                            <img src={images[0].url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-slate-300" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">{i.name}</p>
                          <p className="text-xs text-slate-400">{fmtMoney(finalPrice(i))} each</p>
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex items-center gap-1 rounded-lg bg-slate-100 px-1 py-0.5">
                              <button
                                onClick={() => setQty(i.id, i.qty - 1)}
                                className="rounded p-0.5 text-slate-500 hover:bg-white"
                                aria-label="Decrease"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="min-w-5 text-center text-xs font-bold text-slate-700">{i.qty}</span>
                              <button
                                onClick={() => setQty(i.id, i.qty + 1)}
                                disabled={i.qty >= Number(i.stock)}
                                className="rounded p-0.5 text-slate-500 hover:bg-white disabled:opacity-30"
                                aria-label="Increase"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <button
                              onClick={() => removeFromCart(i.id)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                              aria-label="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <p className="shrink-0 text-sm font-bold text-slate-800">{fmtMoney(finalPrice(i) * i.qty)}</p>
                      </div>
                    );
                  })}

                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-bold text-slate-800">Delivery details</p>
                    <Field label="Name">
                      <Input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Customer name"
                      />
                    </Field>
                    <Field label="Phone">
                      <Input
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder="Mobile number"
                      />
                    </Field>
                    <Field label="Address">
                      <Input
                        value={form.address}
                        onChange={(e) => setForm({ ...form, address: e.target.value })}
                        placeholder="Delivery address (optional)"
                      />
                    </Field>
                    {formError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{formError}</p>}
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700">Total</p>
                    <p className="text-2xl font-bold text-indigo-700">{fmtMoney(subtotal)}</p>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">You'll pay on delivery. Your order is booked as pending.</p>
                  <Button onClick={placeOrder} disabled={placing} className="mt-3 w-full">
                    {placing ? "Booking order…" : "Book Order"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {placed && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="h-9 w-9 text-emerald-500" />
            </div>
            <h3 className="mt-4 text-xl font-bold text-slate-900">Order booked!</h3>
            <p className="mt-1 text-sm text-slate-500">
              Your order <span className="font-bold text-slate-700">{placed.invoice_no}</span> has been placed.
            </p>
            <div className="mt-4 rounded-2xl bg-indigo-50 px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-400">Amount to pay on delivery</p>
              <p className="text-2xl font-bold text-indigo-700">{fmtMoney(placed.total)}</p>
            </div>
            <p className="mt-3 text-xs text-slate-400">The shop will call you to confirm.</p>
            <Button
              className="mt-4 w-full"
              onClick={() => {
                setPlaced(null);
                setCartOpen(false);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}