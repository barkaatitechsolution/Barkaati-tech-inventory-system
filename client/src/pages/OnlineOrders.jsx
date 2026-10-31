import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  MapPin,
  MessageCircle,
  Phone,
  RefreshCw,
  ShoppingBag,
  Truck,
  XCircle
} from "lucide-react";
import { api } from "../api.js";
import { fmtDateTime, fmtMoney } from "../lib/format.js";
import Card from "../components/Card.jsx";
import { Button } from "../components/Field.jsx";

const STATUS_STYLE = {
  booking: "bg-violet-50 text-violet-700",
  paid: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  credit: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500"
};

const STATUS_LABEL = {
  booking: "New booking",
  paid: "Confirmed · paid",
  partial: "Confirmed · partial",
  credit: "Confirmed · credit",
  cancelled: "Cancelled"
};

function phoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("91") && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export default function OnlineOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState("booking");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.onlineOrders();
      setOrders(res.orders || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const bookings = useMemo(() => orders.filter((o) => o.status === "booking"), [orders]);
  const filtered = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter]
  );

  const confirm = async (order, status) => {
    setBusyId(order.id);
    try {
      await api.confirmOnlineOrder(order.id, { status });
      setToast(`${order.invoice_no} confirmed. Stock has been deducted.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (order) => {
    if (!window.confirm(`Cancel ${order.invoice_no}? Stock was never deducted, so nothing will be put back.`)) {
      return;
    }
    setBusyId(order.id);
    try {
      await api.cancelOnlineOrder(order.id);
      setToast(`${order.invoice_no} cancelled.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const tabs = [
    { key: "booking", label: `New bookings (${bookings.length})` },
    { key: "paid", label: "Paid" },
    { key: "partial", label: "Partial" },
    { key: "credit", label: "Credit" },
    { key: "cancelled", label: "Cancelled" },
    { key: "all", label: "All" }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Online orders</h2>
            <p className="text-xs text-slate-500">
              Bookings placed from the public storefront. Confirming an order deducts stock.
            </p>
          </div>
        </div>
        <Button variant="soft" onClick={load} disabled={loading} className="ml-auto !px-3 !py-2 text-xs">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {toast && (
        <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{toast}</p>
      )}
      {error && (
        <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              filter === tab.key
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Card>
          <p className="py-8 text-center text-sm text-slate-500">Loading orders…</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <ShoppingBag className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No orders here yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Orders placed on the public store will appear in this list.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const isBooking = order.status === "booking";
            const wa = phoneDigits(order.customer_phone);
            return (
              <Card key={order.id} className="!p-4 sm:!p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-bold text-indigo-600">{order.invoice_no}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          STATUS_STYLE[order.status] || "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {STATUS_LABEL[order.status] || order.status}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                        <Clock className="h-3 w-3" /> {fmtDateTime(order.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{order.customer}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      {order.customer_phone && (
                        <a
                          href={`tel:${order.customer_phone}`}
                          className="inline-flex items-center gap-1 hover:text-indigo-600"
                        >
                          <Phone className="h-3 w-3" /> {order.customer_phone}
                        </a>
                      )}
                      <span className="inline-flex items-center gap-1">
                        {order.delivery_type === "pickup" ? (
                          <>
                            <ShoppingBag className="h-3 w-3" /> Pickup
                          </>
                        ) : (
                          <>
                            <Truck className="h-3 w-3" /> Delivery
                          </>
                        )}
                      </span>
                      {order.address && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {order.address}
                        </span>
                      )}
                    </div>
                    {order.note && (
                      <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                        Note: {order.note}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-slate-900">{fmtMoney(order.total)}</p>
                    <p className="text-[11px] text-slate-400">
                      {order.items.reduce((a, it) => a + Number(it.qty || 0), 0)} item(s)
                    </p>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100">
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
                      {order.items.map((it) => (
                        <tr key={it.id} className="border-b border-slate-50 last:border-0">
                          <td className="px-3 py-2 text-slate-700">{it.product_name}</td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {it.qty} {it.unit || ""}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">{fmtMoney(it.unit_price)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">
                            {fmtMoney(it.line_total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-500">
                    Subtotal {fmtMoney(order.subtotal)}
                    {Number(order.delivery_fee) > 0 && ` · Delivery ${fmtMoney(order.delivery_fee)}`}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {wa && (
                      <a
                        href={`https://wa.me/${wa}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </a>
                    )}
                    {isBooking && (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() => cancel(order)}
                          disabled={busyId === order.id}
                          className="!px-3 !py-2 text-xs"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Cancel
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => confirm(order, "credit")}
                          disabled={busyId === order.id}
                          className="!px-3 !py-2 text-xs"
                        >
                          Confirm on credit
                        </Button>
                        <Button
                          onClick={() => confirm(order, "paid")}
                          disabled={busyId === order.id}
                          className="!px-3 !py-2 text-xs"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Deliver & paid
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
