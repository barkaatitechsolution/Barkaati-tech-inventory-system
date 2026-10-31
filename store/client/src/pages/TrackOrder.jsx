import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Search,
  ShoppingBag,
  Truck,
  XCircle
} from "lucide-react";
import { api } from "../api.js";
import { useSeo } from "../lib/seo.js";
import { Link } from "../lib/router.jsx";
import { useStore } from "../lib/storeContext";
import { fmtDateTime, fmtMoney } from "../lib/format";
import { Button, Field, Input } from "../components/Field";
import Card from "../components/Card";
import StoreFooter from "../components/StoreFooter";

const STATUS = {
  booking: {
    label: "Order received",
    note: "The shop has received your order and will confirm it shortly. Payment is due on delivery or pickup.",
    className: "bg-violet-50 text-violet-700",
    icon: Clock
  },
  paid: {
    label: "Confirmed · paid",
    note: "The shop has confirmed this order and recorded it as paid.",
    className: "bg-emerald-50 text-emerald-700",
    icon: CheckCircle2
  },
  partial: {
    label: "Confirmed · partial payment",
    note: "The shop has confirmed this order. Part of the payment is still pending.",
    className: "bg-amber-50 text-amber-700",
    icon: CheckCircle2
  },
  credit: {
    label: "Confirmed · on credit",
    note: "The shop has confirmed this order. Payment will be collected on your account.",
    className: "bg-sky-50 text-sky-700",
    icon: CheckCircle2
  },
  cancelled: {
    label: "Cancelled",
    note: "This order was cancelled. If this is unexpected, please contact the shop.",
    className: "bg-slate-100 text-slate-500",
    icon: XCircle
  }
};

function statusFor(order) {
  return (
    STATUS[order?.status] || {
      label: String(order?.status || "Unknown"),
      note: "",
      className: "bg-slate-100 text-slate-600",
      icon: Package
    }
  );
}

export default function TrackOrder() {
  useSeo({
    title: "Track your order",
    description: "Look up an online order with your invoice number and phone number.",
    noindex: true
  });

  const { store } = useStore();
  const [invoice, setInvoice] = useState(
    () => new URLSearchParams(window.location.search).get("invoice") || ""
  );
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const invoiceNo = invoice.trim();
    const phoneNo = phone.trim();
    if (!invoiceNo || !phoneNo) {
      setError("Enter the invoice number from your order and the phone number you used.");
      return;
    }
    setLoading(true);
    try {
      const data = await api.lookupOrder({ invoice_no: invoiceNo, phone: phoneNo });
      setResult(data);
      setInvoice(data?.order?.invoice_no || invoiceNo);
    } catch (e) {
      setResult(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const order = result?.order;
  const status = statusFor(order);
  const StatusIcon = status.icon;

  return (
    <div className="min-h-screen bg-slate-100 pb-10 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Store
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <ShoppingBag className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-slate-900">Track your order</p>
              <p className="text-xs text-slate-500">{store?.name || "Online Store"}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <Card className="!p-5">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-indigo-600" />
            <p className="text-sm font-bold text-slate-800">Find your order</p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Use the invoice number shown after checkout (for example ONL-0001) and the same phone
            number you entered with the order.
          </p>

          <form onSubmit={submit} className="mt-4 space-y-3">
            <Field label="Invoice number" required>
              <Input
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
                placeholder="ONL-0001"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Phone number" required>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Mobile number used for the order"
                inputMode="tel"
                autoComplete="tel"
              />
            </Field>

            {error && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {loading ? "Looking up…" : "Track order"}
            </Button>
          </form>
        </Card>

        {order && (
          <Card className="!p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-bold text-indigo-600">{order.invoice_no}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Placed {fmtDateTime(order.created_at)}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.className}`}
              >
                <StatusIcon className="h-3.5 w-3.5" /> {status.label}
              </span>
            </div>

            {status.note && (
              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {status.note}
              </p>
            )}

            <div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
              <p className="flex items-center gap-1.5">
                {order.delivery_type === "pickup" ? (
                  <>
                    <ShoppingBag className="h-3.5 w-3.5" /> Pickup from the shop
                  </>
                ) : (
                  <>
                    <Truck className="h-3.5 w-3.5" /> Delivery
                  </>
                )}
              </p>
              {order.address && (
                <p className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {order.address}
                </p>
              )}
            </div>

            {order.note && (
              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Note: {order.note}
              </p>
            )}

            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items || []).map((item) => (
                    <tr key={item.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 text-slate-700">{item.product_name}</td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {item.qty} {item.unit || ""}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {fmtMoney(item.unit_price)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {fmtMoney(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-800">{fmtMoney(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Delivery</span>
                <span className="font-semibold text-slate-800">{fmtMoney(order.delivery_fee)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <span className="font-bold text-slate-800">Total</span>
                <span className="text-lg font-bold text-indigo-700">{fmtMoney(order.total)}</span>
              </div>
            </div>

            {result.whatsappUrl && (
              <a
                href={result.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" /> Send order on WhatsApp
              </a>
            )}
          </Card>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}
