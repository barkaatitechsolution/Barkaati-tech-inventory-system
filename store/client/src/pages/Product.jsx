import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Image as ImageIcon,
  Minus,
  Package,
  Plus,
  ShoppingCart
} from "lucide-react";
import { api } from "../api.js";
import { useStore } from "../lib/storeContext";
import { useCart } from "../lib/cartContext";
import { useSeo } from "../lib/seo.js";
import { fmtMoney } from "../lib/format";
import { Button } from "../components/Field";
import StoreFooter from "../components/StoreFooter";

const finalPrice = (p) => {
  const sp = Number(p.selling_price) || 0;
  const disc = Number(p.discount) || 0;
  const tax = Number(p.tax) || 0;
  const taxable = Math.max(0, sp - disc);
  return Math.round((taxable + (taxable * tax) / 100) * 100) / 100;
};

export default function Product({ id, onBack }) {
  const { store } = useStore();
  const { add } = useCart();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);

  useSeo({
    title: product?.name,
    description: product?.description || undefined
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const data = await api.product(id);
        if (!alive) return;
        setProduct(data);
        setQty(1);
        setActiveImage(0);
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
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <Package className="h-7 w-7" />
        </div>
        <p className="font-semibold text-slate-900">Product not found</p>
        <p className="text-sm text-slate-500">{error || "It may have been taken off the online store."}</p>
        <Button onClick={onBack} className="!px-4 !py-2 text-xs">Back to store</Button>
      </div>
    );
  }

  const price = finalPrice(product);
  const market = Number(product.market_price) || 0;
  const save = market > price ? market - price : 0;
  const images = Array.isArray(product.images) ? product.images : [];
  const stock = Number(product.stock) || 0;
  const maxQty = Math.max(1, Math.min(99, Math.floor(stock)));
  const lowStock = stock <= 5;
  const storeClosed = store?.onlineStoreEnabled === false;
  const shownImage = images[Math.min(activeImage, images.length - 1)];

  return (
    <div className="min-h-screen bg-slate-100 pb-24 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex flex-1 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <ShoppingCart className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-slate-900">{store?.name || "Online Store"}</p>
              <p className="text-xs text-slate-500">{store?.tagline || "Fresh stock, delivered"}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200/70">
          <div>
            <div className="flex min-h-[280px] items-center justify-center bg-slate-50">
              {shownImage ? (
                <img
                  src={shownImage.url}
                  alt={product.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center text-slate-300">
                  <ImageIcon className="h-12 w-12" />
                  <p className="mt-2 text-xs font-medium">No photo</p>
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto border-t border-slate-100 p-3">
                {images.map((img, index) => (
                  <button
                    key={img.id || index}
                    type="button"
                    onClick={() => setActiveImage(index)}
                    aria-label={`Show photo ${index + 1}`}
                    aria-pressed={activeImage === index}
                    className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl transition ${
                      activeImage === index
                        ? "ring-2 ring-indigo-500"
                        : "ring-1 ring-slate-200 hover:ring-slate-300"
                    }`}
                  >
                    <img
                      src={img.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{product.name}</h1>
                <p className="mt-1 text-xs text-slate-400">
                  {product.unit || "pcs"}
                  {product.sku ? ` · ${product.sku}` : ""}
                </p>
                <p
                  className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    lowStock ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {lowStock ? `Only ${stock} left in stock` : "In stock"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-indigo-700">{fmtMoney(price)}</p>
                {market > price && <p className="text-xs text-slate-400 line-through">{fmtMoney(market)}</p>}
                {save > 0 && <p className="text-[11px] font-semibold text-emerald-600">Save {fmtMoney(save)}</p>}
              </div>
            </div>

            {product.description ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</p>
                <p className="mt-2 text-sm text-slate-700">{product.description}</p>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-700">Quantity</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 transition hover:bg-slate-100"
                  aria-label="Decrease"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-8 text-center text-lg font-bold text-slate-800">{qty}</span>
                <button
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  disabled={qty >= maxQty}
                  className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Increase"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {storeClosed && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                The online store is currently closed, so new orders cannot be placed.
              </p>
            )}

            <Button
              onClick={() => add(product, qty)}
              disabled={storeClosed}
              className="w-full !py-3"
            >
              <Plus className="h-4 w-4" /> Add to cart — {fmtMoney(price * qty)}
            </Button>
          </div>
        </div>
      </main>

      <StoreFooter />
    </div>
  );
}
