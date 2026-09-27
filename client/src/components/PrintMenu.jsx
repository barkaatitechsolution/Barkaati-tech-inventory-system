import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, FileText } from "lucide-react";

const GAP = 6;
const MARGIN = 8;

export default function PrintMenu({ open, anchorEl, onClose, onThermal, onA4 }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  const place = useCallback(() => {
    const menu = menuRef.current;
    if (!anchorEl || !menu) return;
    const r = anchorEl.getBoundingClientRect();
    if (!r.width || !r.height) {
      setPos(null);
      return;
    }
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;

    let top = r.bottom + GAP;
    if (top + h > window.innerHeight - MARGIN && r.top - GAP - h > MARGIN) {
      top = r.top - GAP - h;
    }
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));

    let left = r.right - w;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));

    setPos((prev) => {
      if (prev && prev.top === top && prev.left === left) return prev;
      return { top, left };
    });
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, onClose, place]);

  if (!open) return null;

  return createPortal(
    <>
      {pos && <div className="fixed inset-0 z-40" onClick={onClose} />}
      <div
        ref={menuRef}
        role="menu"
        style={{
          top: pos ? pos.top : -9999,
          left: pos ? pos.left : -9999,
          visibility: pos ? "visible" : "hidden",
        }}
        className={`fixed z-50 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg ${
          pos ? "" : "pointer-events-none"
        }`}
      >
        <button
          onClick={onThermal}
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
        >
          <Printer className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0">
            <span className="block">Receipt</span>
            <span className="block text-[11px] font-normal text-slate-400">Thermal &middot; 58mm</span>
          </span>
        </button>
        <button
          onClick={onA4}
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
        >
          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0">
            <span className="block">Invoice</span>
            <span className="block text-[11px] font-normal text-slate-400">A4 sheet</span>
          </span>
        </button>
      </div>
    </>,
    document.body
  );
}
