import { useMemo, useState } from "react";
import { BadgeCheck, Minus, PackageSearch, Plus, RefreshCw, Search, Undo2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDateTime, fmtMoney } from "../lib/format.js";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Spinner, Textarea, cx, showToast } from "../components/ui.jsx";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => {
  const r = round2(n);
  return Number.isInteger(r) ? String(r) : String(r);
};

const PAYMENT_LABELS = { cash: "Cash", card: "Card", credit: "Credit", online: "Online" };
const STATUS_TONES = { paid: "green", partial: "amber", credit: "red", booking: "purple" };

export default function Returns() {
  const { version, bump } = useApp();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [sale, setSale] = useState(null);
  const [qtys, setQtys] = useState({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);
  const recent = useAsync(() => api.returns(), [version]);

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

  const rows = useMemo(() => recent.data || [], [recent.data]);

  const search = async () => {
    const invoiceNo = q.trim();
    if (!invoiceNo) return;
    setSearching(true);
    setError(null);
    setSuccess(null);
    setSale(null);
    setQtys({});
    try {
      const found = await api.saleByInvoice(invoiceNo);
      if (!found) throw new Error(`No bill found for "${invoiceNo}"`);
      setSale(found);
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

  const submit = async () => {
    if (!selected.length) return;
    setSaving(true);
    setError(null);
    try {
      const payload = selected.map((it) => ({ sale_item_id: it.id, qty: qtyOf(it.id) }));
      const res = await api.createReturn(sale.id, { reason: reason.trim() || null, items: payload });
      setSuccess(res);
      setQtys({});
      setReason("");
      bump();
      setSale(await api.saleByInvoice(sale.invoice_no));
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Returns" subtitle="Refund items and restock inventory" />

      <div className="space-y-3 px-4">
        <Card className="p-3">
          <p className="text-sm font-semibold text-slate-800">Find a bill to return</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Enter the invoice number printed on the receipt. Returned stock goes back to inventory.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder="e.g. INV-0006"
                disabled={searching}
                className="pl-9"
              />
            </div>
            <Button onClick={search} disabled={searching || !q.trim()}>
              {searching ? "Searching…" : "Find"}
            </Button>
          </div>
        </Card>

        {error ? (
          <Card className="border border-red-100 bg-red-50 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        ) : null}

        {sale ? (
          <>
            <Card className="p-3">
              <div className="flex items-center gap-1.5">
                <Badge tone="blue">{sale.invoice_no}</Badge>
                <Badge tone="slate">{PAYMENT_LABELS[sale.payment_method] || sale.payment_method}</Badge>
                <Badge tone={STATUS_TONES[sale.status] || "slate"}>{sale.status}</Badge>
              </div>
              <p className="mt-1.5 truncate text-sm font-semibold text-slate-800">
                {sale.customer_name || sale.customer || "Walk-in"}
                {sale.customer_phone ? <span className="font-normal text-slate-400"> · {sale.customer_phone}</span> : null}
              </p>
              <p className="text-[11px] text-slate-400">{fmtDateTime(sale.created_at)}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Bill total</p>
                  <p className="text-sm font-semibold text-slate-800">{fmtMoney(sale.total)}</p>
                </div>
                <div className="rounded-xl bg-rose-50 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-400">Already returned</p>
                  <p className="text-sm font-semibold text-rose-600">{fmtMoney(alreadyReturned)}</p>
                </div>
              </div>
              {success ? (
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <BadgeCheck className="h-4 w-4 shrink-0" />
                  Returned {success.items_returned} item(s) · refund {fmtMoney(success.total_refund)} · stock restored
                </div>
              ) : null}
            </Card>

            <Card className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Line items</p>
                  <p className="text-xs text-slate-400">Refund matches the selling price on the bill.</p>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setQtys({})} disabled={!selected.length}>
                    Clear
                  </Button>
                  <Button size="sm" variant="outline" onClick={fillAll} disabled={nothingToReturn}>
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
                    <div key={it.id} className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className={cx("truncate text-sm font-semibold", full ? "text-slate-400" : "text-slate-800")}>
                            {it.product_name}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Sold {num(it.qty)} {it.unit_name || ""} · {fmtMoney(it.unit_price)}/u
                            {Number(it.returned_qty) > 0 ? ` · returned ${num(it.returned_qty)}` : ""}
                          </p>
                          {full ? (
                            <Badge tone="slate">Fully returned</Badge>
                          ) : (
                            <Badge tone="green">{num(remaining)} left</Badge>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-slate-800">{fmtMoney(refunded)}</p>
                          {qty > 0 ? <p className="text-[10px] text-indigo-500">refund</p> : null}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setQty(it.id, qty - stepFor(it))}
                          disabled={qty <= 0}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 active:bg-slate-50 disabled:opacity-40"
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
                          className="h-9 w-20 rounded-xl border border-slate-200 bg-white px-2 text-center text-sm text-slate-800 outline-none focus:border-indigo-400 disabled:bg-slate-50"
                        />
                        <button
                          type="button"
                          onClick={() => setQty(it.id, qty + stepFor(it))}
                          disabled={full || qty >= remaining}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 active:bg-slate-50 disabled:opacity-40"
                          aria-label="Increase"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <span className="ml-auto text-[11px] text-slate-400">Max {num(remaining)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3">
                <Field label="Reason (optional)">
                  <Textarea
                    rows={2}
                    placeholder="Damaged, wrong item, customer returned…"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Total refund</p>
                    <p className="text-2xl font-bold text-indigo-600">{fmtMoney(totalRefund)}</p>
                    <p className="text-[10px] text-slate-400">{selected.length} item(s) · stock will be restocked</p>
                  </div>
                  <Button onClick={submit} disabled={saving || !selected.length}>
                    <Undo2 className="h-4 w-4" /> {saving ? "Returning…" : "Return"}
                  </Button>
                </div>
              </div>
            </Card>
          </>
        ) : null}

        <Card className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">Recent returns</p>
              <p className="text-xs text-slate-400">Audit trail of every return and restock.</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => recent.reload()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-2 divide-y divide-slate-100">
            {recent.loading ? (
              <div className="flex justify-center py-8"><Spinner className="text-brand-600" /></div>
            ) : !rows.length ? (
              <Empty icon={PackageSearch} title="No returns yet" description="Returns you record will appear here." />
            ) : (
              rows.map((r) => (
                <div key={r.id} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{r.invoice_no || "—"}</Badge>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                      {r.customer_name || r.customer || "Walk-in"}
                    </p>
                    <p className="text-sm font-bold text-emerald-600">-{fmtMoney(r.amount ?? r.total_refund)}</p>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">{fmtDateTime(r.created_at)}</span>
                    <span className="truncate text-[10px] text-slate-400">
                      {r.item_count || 0} item(s){r.product_names ? ` · ${r.product_names}` : ""}
                    </span>
                  </div>
                  {r.reason ? <p className="truncate text-[10px] italic text-slate-400">"{r.reason}"</p> : null}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
