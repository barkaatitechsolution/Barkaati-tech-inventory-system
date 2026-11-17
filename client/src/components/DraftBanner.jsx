import { AlertTriangle, RotateCcw, Trash2, CheckCircle2 } from "lucide-react";

const fmtWhen = (ts) => {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
};

export default function DraftBanner({ draft }) {
  if (!draft) return null;

  if (draft.status === "prompt" && draft.pending) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">Unsaved draft found</p>
          <p className="text-[11px] text-amber-700">
            Saved {fmtWhen(draft.pending.savedAt)}. Restore it or discard it to start fresh.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={draft.restore}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restore
          </button>
          <button
            type="button"
            onClick={draft.discard}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
          >
            <Trash2 className="h-3.5 w-3.5" /> Discard
          </button>
        </div>
      </div>
    );
  }

  if (draft.restoredAt && draft.status === "ready") {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        <p className="min-w-0 flex-1 font-medium text-emerald-800">Draft restored.</p>
        <button
          type="button"
          onClick={draft.discard}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-emerald-800 transition hover:bg-emerald-100"
        >
          <Trash2 className="h-3.5 w-3.5" /> Discard draft
        </button>
      </div>
    );
  }

  return null;
}
