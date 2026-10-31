import { useState } from "react";
import {
  ArrowLeft,
  ClipboardList,
  Image as ImageIcon,
  MapPin,
  Minus,
  Plus,
  ShoppingCart,
  Trash2
} from "lucide-react";
import { api } from "../api.js";
import { useStore } from "../lib/storeContext";
import { useCart } from "../lib/cartContext";
import { useSeo } from "../lib/seo.js";
import { rememberOrder } from "../lib/orderStorage.js";
import { fmtMoney } from "../lib/format";
import { Button, Field, Input } from "../components/Field";
import Card from "../components/Card";
import StoreFooter from "../components/StoreFooter";

export default function Cart({ onPlaced, onContinueShopping, onGoTrack }) {
  const { items, setQty, remove, clear, subtotal } = useCart();
  const { store, loading: storeLoading } = useStore();
  useSeo({
    title: "Your order",
    description: "Review your cart and place an order with the shop.",
    noindex: true
  });
  const [deliveryType, setDeliveryType] = useState("delivery");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const [formError, setFormError] = useState(null);

  const deliveryFee = deliveryType === "delivery" ? Number(store?.deliveryFee) || 0 : 0;
  const total = Number((subtotal || 0) + deliveryFee);
  const storeClosed = store?.onlineStoreEnabled === false;

  const placeOrder = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!String(phone || "").trim()) {
      setFormError("Please enter your phone number so the shop can confirm the order.");
      return;
    }
    if (deliveryType === "delivery" && !String(address || "").trim()) {
      setFormError("Please enter the delivery address.");
      return;
    }
    setPlacing(true);
    try {
      const res = await api.createOrder({
        customer_name: String(name || "").trim(),
        customer_phone: String(phone || "").trim(),
        delivery_type: deliveryType,
        address: deliveryType === "delivery" ? String(address || "").trim() : null,
        note: String(note || "").trim() || null,
        items: items.map((i) => ({ product_id: i.id, qty: i.qty }))
      });
      window.open(res.whatsappUrl, "_blank", "noopener");
      rememberOrder({ ...res.order, whatsappUrl: res.whatsappUrl });
      clear();
      onPlaced();
    } catch (err) {
      setFormError(err.message);
      setPlacing(false);
    }
  };

  if (storeLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-24 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={onContinueShopping}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Continue shopping
          </button>
          <div className="flex flex-1 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <ShoppingCart className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-slate-900">Your order</p>
              <p className="text-xs text-slate-500">{store?.name || "Online Store"}</p>
            </div>
          </div>
          <button
            onClick={onGoTrack}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ClipboardList className="h-4 w-4" /> <span className="hidden sm:inline">Track order</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {items.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-400">
              <ShoppingCart className="h-8 w-8" />
            </div>
            <p className="mt-4 font-semibold text-slate-700">Your cart is empty</p>
            <p className="mt-1 text-xs text-slate-500">Browse products and add items to book an order.</p>
            <Button onClick={onContinueShopping} className="!px-4 !py-2 text-xs">Back to store</Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-3">
              {items.map((i) => (
                <div key={i.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                    {Array.isArray(i.images) && i.images.length > 0 ? (
                      <img src={i.images[0].url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{i.name}</p>
                    <p className="text-xs text-slate-400">{i.unit} · {fmtMoney(i.unit_price)} each</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-lg bg-slate-100 px-1 py-0.5">
                        <button onClick={() => setQty(i.id, Number(i.qty) - 1)} className="rounded p-0.5 text-slate-500 transition hover:bg-white" aria-label="Decrease">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-5 text-center text-xs font-bold text-slate-700">{i.qty}</span>
                        <button onClick={() => setQty(i.id, Number(i.qty) + 1)} className="rounded p-0.5 text-slate-500 transition hover:bg-white" aria-label="Increase">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        onClick={() => remove(i.id)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-slate-800">{fmtMoney(Number(i.unit_price) * Number(i.qty))}</p>
                </div>
              ))}
            </div>

            <Card className="!p-5">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-indigo-600" />
                <p className="text-sm font-bold text-slate-800">Delivery details</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Name (optional)">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Customer name"
                    autoComplete="name"
                  />
                </Field>
                <Field label="Phone" required>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Mobile number"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </Field>
                {deliveryType === "delivery" && (
                  <Field label="Delivery address" required className="sm:col-span-2">
                    <Input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Delivery address"
                      autoComplete="street-address"
                    />
                  </Field>
                )}
                <Field label="Note (optional)" className="sm:col-span-2">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Anything the shop should know"
                  />
                </Field>
              </div>
              {formError && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{formError}</p>}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeliveryType("delivery")}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                    deliveryType === "delivery" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  Delivery
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryType("pickup")}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                    deliveryType === "pickup" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  Pickup
                </button>
              </div>
            </Card>

            <Card className="!p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">Order summary</p>
                <p className="text-sm font-semibold text-slate-700">{items.reduce((a, i) => a + Number(i.qty), 0)} item(s)</p>
              </div>
              <div className="mt-3 space-y-2">
                {items.map((i) => (
                  <div key={i.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      {i.name} <span className="text-slate-400">× {i.qty}</span>
                    </span>
                    <span className="font-semibold text-slate-800">{fmtMoney(Number(i.unit_price) * Number(i.qty))}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="font-semibold text-slate-800">{fmtMoney(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Delivery</span>
                  <span className="font-semibold text-slate-800">{fmtMoney(deliveryFee)}</span>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm font-bold text-slate-800">Total</p>
                  <p className="text-xl font-bold text-indigo-700">{fmtMoney(total)}</p>
                </div>
              </div>
              {storeClosed && (
                <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  The online store is currently closed. Please try again later.
                </p>
              )}
              <Button
                type="button"
                onClick={placeOrder}
                disabled={placing || storeClosed}
                className="mt-4 w-full"
              >
                {placing ? "Placing order…" : "Place order via WhatsApp"}
              </Button>
              <p className="mt-2 text-center text-[11px] text-slate-400">The order is saved and WhatsApp opens with the order summary for you to send.</p>
            </Card>
          </div>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}
