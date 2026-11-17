import { useEffect, useState } from "react";
import { CheckCircle2, Printer, ReceiptText, RotateCcw, Search, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDateTime, fmtMoney } from "../lib/format.js";
import { printReceipt } from "../lib/printer.js";
import {
  Badge,
  Button,
  Card,
  Confirm,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  cx,
  showToast
} from "../components/ui.jsx";

const statusTone = (s) => (s === "paid" ? "green" : s === "partial" ? "amber" : s === "returned" ? "purple" : "red");

function SaleDetail({ saleId, open, onClose, onChanged }) {
  const { store } = useApp();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQty, setReturnQty] = useState({});
  const [returnReason, setReturnReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!saleId) return;
    setLoading(true);
    try {
      setSale(await api.sale(saleId));
    } catch (e) {
      showToast(e?.message || "Could not load bill", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && saleId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saleId]);

  const markPaid = async () => {
    setBusy(true);
    try {
      const updated = await api.updateSaleStatus(sale.id, { status: "paid", paid: sale.total });
      setSale({ ...sale, ...updated, items: updated.items || sale.items });
      showToast("Marked as paid");
      onChanged?.();
    } catch (e) {
      showToast(e?.message || "Could not update", "error");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.deleteSale(sale.id);
      showToast("Bill deleted, stock restored");
      setConfirmDelete(false);
      onChanged?.();
      onClose();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    } finally {
      setBusy(false);
    }
  };

  const doReturn = async () => {
    const items = Object.entries(returnQty)
      .map(([id, qty]) => ({ sale_item_id: Number(id), qty: Number(qty) }))
      .filter((i) => i.qty > 0);
    if (!items.length) {
      showToast("Enter a quantity to return", "error");
      return;
    }
    setBusy(true);
    try {
      await api.createReturn(sale.id, { items, reason: returnReason });
      showToast("Return saved, stock restored");
      setReturnOpen(false);
      setReturnQty({});
      setReturnReason("");
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e?.message || "Could not save return", "error");
    } finally {
      setBusy(false);
    }
  };

  const print = async () => {
    try {
      await printReceipt(sale, sale.items, store || {});
      showToast("Sent to printer");
    } catch (e) {
      showToast(e?.message || "Printing failed", "error");
    }
  };

  return (
    <>
      <Modal
        open={open}
        title={sale ? `Bill ${sale.invoice_no}` : "Bill"}
        onClose={onClose}
        wide
        footer={
          sale ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={print}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              {Number(sale.total) > Number(sale.paid) ? (
                <Button variant="success" loading={busy} onClick={markPaid}>
                  <CheckCircle2 className="h-4 w-4" /> Mark paid
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setReturnOpen(true)}>
                  <RotateCcw className="h-4 w-4" /> Return
                </Button>
              )}
              {Number(sale.total) > Number(sale.paid) ? (
                <Button variant="secondary" onClick={() => setReturnOpen(true)}>
                  <RotateCcw className="h-4 w-4" /> Return
                </Button>
              ) : null}
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </div>
          ) : null
        }
      >
        {loading || !sale ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-brand-600" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {sale.customer_name || "Walk-in customer"}
                </p>
                <p className="text-xs text-slate-400">{sale.customer_phone || "No phone"}</p>
                <p className="text-xs text-slate-400">{fmtDateTime(sale.created_at)}</p>
              </div>
              <Badge tone={statusTone(sale.status)}>{sale.status}</Badge>
            </div>

            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {(sale.items || []).map((it) => (
                <div key={it.id} className="flex items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{it.product_name}</p>
                    <p className="text-[11px] text-slate-400">
                      {it.qty} × {fmtMoney(it.unit_price)}
                      {Number(it.tax) ? ` · ${it.tax}% tax` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">{fmtMoney(it.line_total)}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span>{fmtMoney(sale.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Discount</span>
                <span>-{fmtMoney(sale.discount)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Tax</span>
                <span>{fmtMoney(sale.tax)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900">
                <span>Total</span>
                <span>{fmtMoney(sale.total)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Paid</span>
                <span>{fmtMoney(sale.paid)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Payment</span>
                <span className="uppercase">{sale.payment_method}</span>
              </div>
            </div>

            {sale.note ? <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{sale.note}</p> : null}

            {sale.returns?.length ? (
              <div className="rounded-xl border border-purple-100 bg-purple-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-purple-700">Returns</p>
                {sale.returns.map((r) => (
                  <p key={r.id} className="mt-1 text-xs text-purple-800">
                    {fmtMoney(r.amount)} · {r.reason || "No reason"}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={returnOpen}
        title="Return items"
        onClose={() => setReturnOpen(false)}
        footer={
          <Button className="w-full" loading={busy} onClick={doReturn}>
            Save return
          </Button>
        }
      >
        <div className="space-y-2">
          {(sale?.items || []).map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{it.product_name}</p>
                <p className="text-[11px] text-slate-400">
                  Sold {it.qty} · {fmtMoney(it.unit_price)}
                </p>
              </div>
              <Input
                value={returnQty[it.id] ?? ""}
                onChange={(e) => setReturnQty((q) => ({ ...q, [it.id]: e.target.value }))}
                inputMode="decimal"
                placeholder="0"
                className="w-20 text-center"
              />
            </div>
          ))}
          <Field label="Reason">
            <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={confirmDelete}
        title="Delete this bill?"
        message="The bill will be removed and its stock added back. This cannot be undone."
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </>
  );
}

export default function Sales() {
  const { version, bump } = useApp();
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  const { data, loading, error, reload } = useAsync(
    () => api.sales({ status, q: query, limit: 300 }),
    [status, query, version]
  );

  const changed = () => {
    bump();
    reload();
  };

  return (
    <div className="pb-24">
      <PageHeader title="Sales" subtitle={`${data?.length || 0} bills`} />
      <div className="px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoice, name or phone"
            className="pl-9"
          />
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          {[
            ["", "All"],
            ["paid", "Paid"],
            ["partial", "Partial"],
            ["unpaid", "Unpaid"]
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatus(key)}
              className={cx(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                status === key ? "bg-brand-700 text-white" : "bg-white text-slate-600"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 px-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-brand-600" />
          </div>
        ) : error ? (
          <Card className="border border-red-100 bg-red-50">
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        ) : data?.length ? (
          <div className="space-y-2">
            {data.map((sale) => (
              <button
                key={sale.id}
                type="button"
                onClick={() => setSelected(sale.id)}
                className="w-full rounded-2xl bg-white p-3 text-left shadow-sm active:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {sale.customer_name || "Walk-in customer"}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {sale.invoice_no} · {fmtDateTime(sale.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{fmtMoney(sale.total)}</p>
                    <Badge tone={statusTone(sale.status)}>{sale.status}</Badge>
                  </div>
                </div>
                {Number(sale.total) > Number(sale.paid) ? (
                  <p className="mt-1 text-[11px] font-medium text-amber-600">
                    Balance {fmtMoney(Number(sale.total) - Number(sale.paid))}
                  </p>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <Empty icon={ReceiptText} title="No bills found" description="Sales you make will appear here." />
        )}
      </div>

      <SaleDetail
        open={!!selected}
        saleId={selected}
        onClose={() => setSelected(null)}
        onChanged={changed}
      />
    </div>
  );
}
