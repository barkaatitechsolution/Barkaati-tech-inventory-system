import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import ThemeToggle from "./ThemeToggle.jsx";

export const cx = (...args) => args.filter(Boolean).join(" ");

export function Spinner({ className = "" }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin", className)} />;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  loading = false,
  type = "button",
  ...props
}) {
  const variants = {
    primary: "bg-brand-700 text-white active:bg-brand-800 disabled:bg-brand-300",
    secondary: "bg-slate-100 text-slate-800 active:bg-slate-200",
    outline: "border border-slate-300 bg-white text-slate-800 active:bg-slate-50",
    danger: "bg-red-600 text-white active:bg-red-700",
    ghost: "text-slate-600 active:bg-slate-100",
    success: "bg-emerald-600 text-white active:bg-emerald-700"
  };
  const sizes = {
    sm: "h-9 px-3 text-sm rounded-lg",
    md: "h-11 px-4 text-sm rounded-xl",
    lg: "h-12 px-5 text-base rounded-xl"
  };
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-semibold transition disabled:opacity-60",
        variants[variant],
        sizes[size],
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function IconButton({ children, className = "", ...props }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 active:bg-slate-100",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }) {
  return <div className={cx("rounded-2xl bg-white p-4 shadow-sm", className)}>{children}</div>;
}

export function Field({ label, hint, error, children, className = "" }) {
  return (
    <label className={cx("block", className)}>
      {label ? <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span> : null}
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function Input({ className = "", ...props }) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function Textarea({ className = "", rows = 3, ...props }) {
  return <textarea rows={rows} className={cx(inputClass, "resize-none", className)} {...props} />;
}

export function Select({ className = "", children, ...props }) {
  return (
    <select className={cx(inputClass, "appearance-none", className)} {...props}>
      {children}
    </select>
  );
}

export function Badge({ children, tone = "slate", className = "" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    blue: "bg-brand-100 text-brand-700",
    purple: "bg-purple-100 text-purple-700"
  };
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div
        className={cx(
          "animate-sheet modal-sheet flex w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-2xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <IconButton onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <div className="safe-bottom border-t border-slate-100 p-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ icon: Icon = AlertCircle, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description ? <p className="mt-1 max-w-xs text-xs text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-8">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right}
        <ThemeToggle />
      </div>
    </div>
  );
}

// ─── Toasts ───────────────────────────────────────────────────
let toastSeq = 0;
const toastListeners = new Set();
const toastQueue = [];

export function showToast(message, tone = "success") {
  const item = { id: ++toastSeq, message, tone };
  toastQueue.push(item);
  toastListeners.forEach((fn) => fn([...toastQueue]));
  setTimeout(() => {
    const idx = toastQueue.findIndex((t) => t.id === item.id);
    if (idx >= 0) toastQueue.splice(idx, 1);
    toastListeners.forEach((fn) => fn([...toastQueue]));
  }, 3200);
}

export function Toaster() {
  const [items, setItems] = useState([...toastQueue]);
  useEffect(() => {
    toastListeners.add(setItems);
    return () => toastListeners.delete(setItems);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-3 safe-top">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            "flex w-full max-w-sm items-start gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-white shadow-lg",
            t.tone === "error" ? "bg-red-600" : t.tone === "info" ? "bg-slate-800" : "bg-emerald-600"
          )}
        >
          {t.tone === "error" ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export function Confirm({ open, title, message, confirmLabel = "Delete", onConfirm, onClose, danger = true }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} className="flex-1" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}
