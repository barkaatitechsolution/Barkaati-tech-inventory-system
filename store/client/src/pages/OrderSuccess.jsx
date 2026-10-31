import { useState } from "react";
import { ArrowLeft, CheckCircle2, MessageCircle, PackageSearch } from "lucide-react";
import { useSeo } from "../lib/seo.js";
import { recallOrder } from "../lib/orderStorage.js";
import { Link } from "../lib/router.jsx";
import { fmtMoney } from "../lib/format";
import { Button } from "../components/Field";

export default function OrderSuccess({ order: provided, onDone }) {
  const [order] = useState(() => provided || recallOrder());
  useSeo({ title: "Order placed", noindex: true });

  const orderNo = order?.order_no || order?.invoice_no || "";
  const total = Number(order?.total) || 0;
  const whatsappUrl = order?.whatsappUrl || "";
  const trackHref = orderNo ? `/track?invoice=${encodeURIComponent(orderNo)}` : "/track";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl ring-1 ring-slate-200/70">
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
            order ? "bg-emerald-50" : "bg-amber-50"
          }`}
        >
          {order ? (
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          ) : (
            <PackageSearch className="h-8 w-8 text-amber-500" />
          )}
        </div>

        {order ? (
          <>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Order placed!</h1>
            <p className="mt-1 text-sm text-slate-500">
              Your order <span className="font-bold text-slate-700">{orderNo}</span> has been saved.
            </p>
            <div className="mt-4 rounded-2xl bg-indigo-50 px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-400">Total</p>
              <p className="text-2xl font-bold text-indigo-700">{fmtMoney(total)}</p>
            </div>
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" /> Send via WhatsApp
              </a>
            )}
            <Link
              href={trackHref}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <PackageSearch className="h-4 w-4" /> Track this order
            </Link>
            <Button onClick={onDone} className="mt-2 w-full">
              <ArrowLeft className="h-4 w-4" /> Back to store
            </Button>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Order saved</h1>
            <p className="mt-1 text-sm text-slate-500">
              We could not find the details of the last order in this browser. Look it up with your
              invoice number and phone number.
            </p>
            <Link
              href="/track"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              <PackageSearch className="h-4 w-4" /> Track an order
            </Link>
            <Button onClick={onDone} className="mt-2 w-full">
              <ArrowLeft className="h-4 w-4" /> Back to store
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
