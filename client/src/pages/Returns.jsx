import { useEffect, useState } from "react";
import { Search, RefreshCw, Plus, Minus, BadgeCheck, PackageSearch } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import { fmtDateTime } from "../lib/format.js";

const money = (n) =>
  `Rs ${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const num = (n) => {
  const r = round2(n);
  return Number.isInteger(r) ? String(r) : String(r);
};

const PAYMENT_LABELS = { cash: "Cash", card: "Card", credit: "Credit", online: "Online" };

const STATUS_COLORS = {
  paid: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  credit: "bg-rose-50 text-rose-700",
  booking: "bg-violet-50 text-violet-700"
};

export default function Returns() {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [sale, setSale] = useState(null);
  const [qtys, setQtys] = useState({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const items = sale?.items || [];
  const remainingOf = (it) => round2(Number(it.qty) - (Number(it.returned_qty) || 0));
  const qtyOf = (id) => round2(qtys[id] || 0);
  const selected = items.filter((it) => qtyOf(it.id) > 0);
  const totalRefund = selected.reduce((sum, it) => sum + Number(it.unit_price) * qtyOf(it.id), 0);
  const alreadyReturned = items.reduce(
    (sum, it) => sum + (Number(it.returned_qty) || 0) * Number(it.unit_price),
    0
  );
  const nothingToReturn = items.length > 0 && items.every((it) => remainingOf(it) <= 0);

  const loadRecent = async () => {
    setLoadingRecent(true);
    try {
      setRecent(await api.returns());
    } catch {
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async () => {
    const invoiceNo = q.trim();
    if (!invoiceNo) return;
    setSearching(true);
    setError(null);
    setSuccess(null);
    setSale(null);
    setQtys({});
    try {
      setSale(await api.saleByInvoice(invoiceNo));
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  };

  const setQty = (id, value) => {
    const it = items.find((row) => row.id === id);
    if (!it) return;
    const maxQty = remainingOf(it);
    setQtys((prev) => ({ ...prev, [id]: Math.max(0, Math.min(maxQty, round2(value))) }));
  };

  const stepFor = (it) => {
    const remaining = remainingOf(it);
    if (remaining >= 1) return 1;
    if (remaining > 0) return round2(Math.max(0.5, remaining / 2));
    return 1;
  };

  const fillAll = () => {
    const next = {};
    for (const it of items) next[it.id] = remainingOf(it);
    setQtys(next);
  };

  const clearQtys = () => setQtys({});

  const submit = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const payload = selected.map((it) => ({ sale_item_id: it.id, qty: qtyOf(it.id) }));
      const res = await api.createReturn(sale.id, { reason: reason.trim() || null, items: payload });
      setSuccess(res);
      setQtys({});
      setReason("");
      loadRecent();
      setSale(await api.saleByInvoice(sale.invoice_no));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <p className="text-sm font-semibold text-slate-800">Find a bill to return</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Enter the invoice number printed on the receipt. Returned stock is added straight back to inventory.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="e.g. INV-0006"
              disabled={searching}
              autoFocus
            />
          </div>
          <Button onClick={search} disabled={searching || !q.trim()}>
            {searching ? "Searching…" : "Find bill"}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {sale && (
        <>
          <Card className="!p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-indigo-50 px-2 py-0.5 text-[11px] font-bold tracking-wide text-indigo-600">
                    {sale.invoice_no}
                  </span>
                  <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-600">
                    {PAYMENT_LABELS[sale.payment_method] || sale.payment_method}
                  </span>
                  <span
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold uppercase ${
                      STATUS_COLORS[sale.status] || "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {sale.status}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {sale.customer}
                  {sale.customer_phone && (
                    <span className="font-normal text-slate-400"> · {sale.customer_phone}</span>
                  )}
                </p>
                <p className="text-xs text-slate-400">{fmtDateTime(sale.created_at)}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Bill total</p>
                  <p className="font-semibold text-slate-800">{money(sale.total)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Already returned</p>
                  <p className="font-semibold text-rose-600">{money(alreadyReturned)}</p>
                </div>
              </div>
            </div>

            {success && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
                <BadgeCheck className="h-4 w-4 shrink-0" />
                Returned {success.items_returned} item(s) · refund{" "}
                {money(success.total_refund)} · stock restored to inventory
              </div>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Line items</h3>
                <p className="text-xs text-slate-400">
                  Refund matches the selling price on the bill.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="!px-3 !py-2 text-xs"
                  onClick={clearQtys}
                  disabled={selected.length === 0}
                >
                  Clear
                </Button>
                <Button
                  variant="soft"
                  className="!px-3 !py-2 text-xs"
                  onClick={fillAll}
                  disabled={nothingToReturn}
                >
                  Return all
                </Button>
              </div>
            </div>

            <div className="mt-2 divide-y divide-slate-100">
              {items.map((it) => {
                const remaining = remainingOf(it);
                const qty = qtyOf(it.id);
                const refunded = qty * Number(it.unit_price);
                const full = remaining <= 0;
                return (
                  <div key={it.id} className="flex flex-wrap items-center gap-3 py-4">
                    <div className="min-w-0 flex-1 basis-52">
                      <p className={`text-sm font-semibold ${full ? "text-slate-400" : "text-slate-800"}`}>
                        {it.product_name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Sold {num(it.qty)} {it.unit_name || ""} · {money(it.unit_price)}/u
                        {Number(it.returned_qty) > 0 && ` · returned ${num(it.returned_qty)}`}
                      </p>
                      {full ? (
                        <span className="mt-1 inline-block rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                          Fully returned
                        </span>
                      ) : (
                        <span className="mt-1 inline-block rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
                          {num(remaining)} left
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setQty(it.id, qty - stepFor(it))}
                        disabled={qty <= 0}
                        className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Decrease"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={qty || ""}
                        onChange={(e) => setQty(it.id, e.target.value)}
                        disabled={full}
                        className="h-8 w-16 rounded-xl border border-slate-200 bg-white px-2 text-center text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
                      />
                      <button
                        onClick={() => setQty(it.id, qty + stepFor(it))}
                        disabled={full || qty >= remaining}
                        className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Increase"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="w-24 text-right">
                      <p className="text-sm font-bold text-slate-800">{money(refunded)}</p>
                      {qty > 0 && <p className="text-[11px] text-indigo-500">refund</p>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Field label="Reason (optional)">
                  <Textarea
                    rows={2}
                    placeholder="Damaged, wrong item, customer returned…"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Total refund</p>
                <p className="text-2xl font-bold text-indigo-600">{money(totalRefund)}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {selected.length} item(s) · stock will be restocked
                </p>
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <Button onClick={submit} disabled={saving || selected.length === 0}>
                {saving
                  ? "Returning…"
                  : `Return ${selected.length} item(s) · Refund ${money(totalRefund)}`}
              </Button>
            </div>
          </Card>
        </>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Recent returns</h3>
            <p className="text-xs text-slate-400">Audit trail of every return and restock.</p>
          </div>
          <Button variant="ghost" className="!p-2" title="Refresh" onClick={loadRecent}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-3 divide-y divide-slate-100">
          {loadingRecent ? (
            <p className="px-1 py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <PackageSearch className="h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-400">No returns yet</p>
            </div>
          ) : (
            recent.map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {r.invoice_no}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                    {r.customer}
                  </p>
                  <p className="text-sm font-bold text-emerald-600">-{money(r.total_refund)}</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-400">{fmtDateTime(r.created_at)}</span>
                  <span className="truncate text-[11px] text-slate-400">
                    {r.item_count} item(s) · {(r.items || []).map((i) => i.product_name).join(", ")}
                  </span>
                </div>
                {r.reason && (
                  <p className="mt-0.5 truncate text-[11px] italic text-slate-400">"{r.reason}"</p>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}