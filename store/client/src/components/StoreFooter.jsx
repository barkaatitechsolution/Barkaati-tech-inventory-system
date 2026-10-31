import { MapPin, MessageCircle, Phone, ShoppingBag } from "lucide-react";
import { Link } from "../lib/router.jsx";
import { useStore } from "../lib/storeContext";

export default function StoreFooter() {
  const { store } = useStore();
  if (!store) return null;

  const phoneDigits = String(store.phone || "").replace(/\D/g, "");
  const whatsappDigits = String(store.whatsappNumber || store.phone || "").replace(/\D/g, "");

  return (
    <footer className="mx-auto mt-10 w-full max-w-7xl px-4 pb-8 sm:px-6">
      <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="font-bold text-slate-900">{store.name}</p>
            {store.tagline && <p className="mt-0.5 text-xs text-slate-500">{store.tagline}</p>}

            <div className="mt-3 space-y-1.5 text-xs text-slate-500">
              {store.address && (
                <p className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{store.address}</span>
                </p>
              )}
              {store.phone && (
                <a
                  href={`tel:${phoneDigits}`}
                  className="flex items-center gap-1.5 transition hover:text-indigo-600"
                >
                  <Phone className="h-3.5 w-3.5 shrink-0" /> {store.phone}
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-600 transition hover:bg-slate-50"
            >
              <ShoppingBag className="h-3.5 w-3.5" /> Shop
            </Link>
            <Link
              href="/track"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-600 transition hover:bg-slate-50"
            >
              Track order
            </Link>
            {whatsappDigits && (
              <a
                href={`https://wa.me/${whatsappDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700 transition hover:bg-emerald-100"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </a>
            )}
          </div>
        </div>

        {store.footerText && (
          <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
            {store.footerText}
          </p>
        )}
      </div>
    </footer>
  );
}
