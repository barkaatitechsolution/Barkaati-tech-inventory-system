import { Compass } from "lucide-react";
import { useSeo } from "../lib/seo.js";
import { Link } from "../lib/router.jsx";

export default function NotFound() {
  useSeo({ title: "Page not found", noindex: true });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl ring-1 ring-slate-200/70">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <Compass className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-1 text-sm text-slate-500">
          The page you are looking for does not exist or may have moved.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Back to store
          </Link>
          <Link
            href="/track"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Track an order
          </Link>
        </div>
      </div>
    </div>
  );
}
