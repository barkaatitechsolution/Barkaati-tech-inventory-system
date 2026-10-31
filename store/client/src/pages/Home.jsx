import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Package,
  Search,
  ShoppingBag,
  ShoppingCart
} from "lucide-react";
import { api } from "../api.js";
import { useStore } from "../lib/storeContext";
import { useCart } from "../lib/cartContext";
import { useSeo } from "../lib/seo.js";
import { useDebouncedState } from "../lib/useDebounced";
import { Button } from "../components/Field";
import SearchableSelect from "../components/SearchableSelect";
import StoreFooter from "../components/StoreFooter";
import ProductCard from "../components/ProductCard";

export default function Home({ onOpenProduct, onGoCart, onGoTrack }) {
  const { store, loading: storeLoading, error: storeError, reload: reloadStore } = useStore();
  const { items, add } = useCart();
  useSeo({
    title: store?.name,
    description: store?.tagline || (store?.address ? `${store.name} — ${store.address}` : undefined)
  });

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const [p, c] = await Promise.all([api.products(), api.categories()]);
        if (!alive) return;
        setProducts(p || []);
        setCategories(c || []);
        setError(null);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return products.filter((p) => {
      const matchesQuery =
        !q || [p.name, p.sku, p.category].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      const matchesCat = !category || String(p.category_id) === String(category);
      return matchesQuery && matchesCat;
    });
  }, [products, debouncedSearch, category]);

  const categoryOptions = [
    { value: "", label: "All categories" },
    ...categories.map((c) => ({ value: c.id, label: c.name }))
  ];

  const cartCount = items.reduce((a, i) => a + Number(i.qty), 0);
  const storeClosed = store?.onlineStoreEnabled === false;

  return (
    <div className="min-h-screen bg-slate-100 pb-24 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <ShoppingBag className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-slate-900">{store?.name || "Online Store"}</p>
              <p className="text-xs text-slate-500">{store?.tagline || "Fresh stock, delivered"}</p>
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
          <button
            onClick={onGoTrack}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ClipboardList className="h-4 w-4" /> Track
          </button>
          <button
            onClick={onGoCart}
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
      </header>

      {storeClosed && (
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            The online store is currently closed. You can browse the catalogue, but new orders
            cannot be placed right now.
          </p>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {storeError ? (
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <p>Failed to load store: {storeError}</p>
            <Button variant="ghost" onClick={reloadStore} className="mt-2 !px-3 !py-1.5 text-xs">
              Try again
            </Button>
          </div>
        ) : storeLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <div key={i} className="h-60 animate-pulse rounded-2xl bg-white/80 ring-1 ring-slate-200/60" />
            ))}
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <div key={i} className="h-60 animate-pulse rounded-2xl bg-white/80 ring-1 ring-slate-200/60" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <p>Failed to load products: {error}</p>
            <Button
              variant="ghost"
              onClick={() => setReloadKey((key) => key + 1)}
              className="mt-2 !px-3 !py-1.5 text-xs"
            >
              Try again
            </Button>
          </div>
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
            {filtered.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onOpen={onOpenProduct}
                onAdd={add}
                storeClosed={storeClosed}
              />
            ))}
          </div>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}
