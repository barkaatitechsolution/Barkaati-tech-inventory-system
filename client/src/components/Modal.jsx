import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useOverlay } from "../lib/overlays.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, subtitle, children, footer, wide, scrollRef }) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);

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

  // Move keyboard focus into the dialog, keep Tab inside it, and hand focus
  // back to the control that opened it when the dialog closes.
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    restoreRef.current = document.activeElement;

    const focusable = () =>
      Array.from(node.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    if (!node.contains(document.activeElement)) {
      const first = focusable()[0];
      (first || node).focus({ preventScroll: true });
    }

    const trap = (e) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", trap);

    return () => {
      node.removeEventListener("keydown", trap);
      const restore = restoreRef.current;
      if (restore && typeof restore.focus === "function" && document.contains(restore)) {
        restore.focus({ preventScroll: true });
      }
    };
  }, [open]);

  // Register with the overlay stack so the phone's back button closes this
  // dialog before it starts walking the page trail.
  useOverlay(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-2 sm:p-6">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative my-1 w-full rounded-2xl bg-white shadow-2xl outline-none ring-1 ring-slate-200 sm:my-4 sm:max-w-[calc(100vw-3rem)] ${
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
        <div ref={scrollRef} className="modal-scroll max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
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