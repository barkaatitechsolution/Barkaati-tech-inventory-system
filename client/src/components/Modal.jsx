import { useEffect } from "react";
import { X } from "lucide-react";

export default function Modal({ open, onClose, title, subtitle, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-2 sm:p-6">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative my-1 w-full rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 sm:my-4 sm:max-w-[calc(100vw-3rem)] ${
          wide ? "sm:max-w-3xl" : "sm:max-w-xl"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">{title}</h3>
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}