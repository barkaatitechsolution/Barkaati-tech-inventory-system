import { useEffect, useMemo, useState } from "react";
import { Plus, Search, ShoppingCart, Eye, Trash2, CreditCard, X, Printer, Minus, FileSpreadsheet, FileText, MessageCircle, Ticket, BadgeCheck, RotateCcw } from "lucide-react";
import * as XLSX from "xlsx";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney, fmtDateTime } from "../lib/format.js";
import { printReceipt, printInvoiceA4 } from "../lib/receipt.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { buildSaleWhatsAppText, sendWhatsApp } from "../lib/whatsapp.js";

const PAGE_SIZE = 20;

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "credit", label: "Credit" },
  { value: "online", label: "Online" }
];

const STATUS_COLORS = {
  paid: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  credit: "bg-rose-50 text-rose-700",
  booking: "bg-violet-50 text-violet-700"
};

export default function Sales({ action, onActionConsumed }) {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [open, setOpen] = useState(false);
  const [viewSale, setViewSale] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const [printFor, setPrintFor] = useState(null);

  const doPrint = async (id, layout) => {
    try {
      const detail = await api.sale(id);
      const info = getStoreInfo();
      if (layout === "a4") printInvoiceA4(detail, detail.items || [], info);
      else printReceipt(detail, detail.items || [], info);
    } catch {
      alert("Failed to load sale details for printing");
    }
  };

  const doWhatsApp = async (s) => {
    try {
      const detail = await api.sale(s.id);
      const info = getStoreInfo();
      sendWhatsApp(buildSaleWhatsAppText(info, detail, detail.items || []), detail.customer_phone);
    } catch {
      alert("Failed to load sale details for WhatsApp");
    }
  };

  useEffect(() => {
    if (action?.type === "sale") {
      setOpen(true);
      onActionConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.nonce]);

  const load = async () => {
    setLoading(true);
    try {
      const [s, p, c, u] = await Promise.all([api.sales(), api.products(), api.customers(), api.measuringUnits()]);
      setRows(s);
      setProducts(p);
      setCustomers(c);
      setUnits(u);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    return rows.filter((s) => {
      const matchesQuery =
        !q ||
        [s.invoice_no, s.customer, s.payment_method, s.note]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      const matchesStatus = !statusFilter || s.status === statusFilter;
      const ts = new Date(s.created_at).getTime();
      const matchesDate = (!from || ts >= from) && (!to || ts <= to);
      return matchesQuery && matchesStatus && matchesDate;
    });
  }, [rows, search, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const total = rows.reduce((a, s) => a + (Number(s.total) || 0), 0);
    const paid = rows.reduce((a, s) => a + (Number(s.paid) || 0), 0);
    const outstanding = total - paid;
    const count = rows.length;
    const profit = rows.reduce((a, s) => a + (Number(s.profit) || 0), 0);
    return { total, paid, outstanding, count, profit };
  }, [rows]);

  const openCreate = () => setOpen(true);

  const exportExcel = () => {
    const data = filtered.map((s) => ({
      "Invoice No": s.invoice_no,
      "Date": fmtDateTime(s.created_at),
      "Customer": s.customer || "Walk-in",
      "Payment Method": s.payment_method,
      "Status": s.status,
      "Total": Math.round((Number(s.total) || 0) * 100) / 100,
      "Paid": Math.round((Number(s.paid) || 0) * 100) / 100,
      "Outstanding": Math.round(((Number(s.total) || 0) - (Number(s.paid) || 0)) * 100) / 100,
      "HSN": s.hsn_codes || "—",
      "Tax %": s.tax_rates || "—",
      "Tax Amt": Math.round((Number(s.tax_amt) || 0) * 100) / 100,
      "Profit": Math.round((Number(s.profit) || 0) * 100) / 100
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [
      { wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 14 },
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales");
    XLSX.writeFile(wb, `sales_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setToast(`Exported ${data.length} sale(s) to Excel`);
  };

  const handleCreate = async (saleData) => {
    setSaving(true);
    try {
      const res = await api.createSale(saleData);
      setOpen(false);
      const notes = [];
      if (res.voucher?.code) {
        const amt = res.voucher.discount_type === "percent" ? `${res.voucher.discount_value}%` : `Rs ${res.voucher.discount_value}`;
        notes.push(`Voucher ${res.voucher.code} (${amt}) printed on bill — ${res.voucher.campaign_name}`);
      }
      if (res.redeemed) {
        notes.push(`Voucher ${res.redeemed.code} used, ${fmtMoney(res.redeemed.discount)} off · ${res.redeemed.remaining_uses} use${res.redeemed.remaining_uses === 1 ? "" : "s"} left`);
      }
      setToast(notes.length ? `Sale created · ${notes.join(" · ")}` : "Sale created");
      await load();
    } catch (err) {
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (saleId, status, paid) => {
    try {
      await api.updateSaleStatus(saleId, { status, paid });
      setToast("Status updated");
      setViewSale(null);
      await load();
    } catch (err) {
      setToast("Failed to update status");
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteSale(toDelete.id);
      setToDelete(null);
      setToast("Sale deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  const totalFor = (s) => {
    const items = s.items || [];
    if (items.length > 0) {
      return items.reduce((a, it) => a + (Number(it.unit_price) * Number(it.qty)), 0);
    }
    return Number(s.total) || 0;
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Sales", value: fmtMoney(stats.total), color: "text-slate-800" },
          { label: "Paid", value: fmtMoney(stats.paid), color: "text-emerald-600" },
          { label: "Outstanding", value: fmtMoney(stats.outstanding), color: stats.outstanding > 0 ? "text-rose-600" : "text-emerald-600" },
          { label: "Profit", value: fmtMoney(stats.profit), color: "text-indigo-600" },
          { label: "Transactions", value: stats.count, color: "text-slate-600" }
        ].map((s) => (
          <Card key={s.label} className="!p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className={`mt-1 text-xl font-bold ${s.color}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoices, customers…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <SearchableSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={[
            { value: "", label: "All status" },
            { value: "booking", label: "Booking" },
            { value: "paid", label: "Paid" },
            { value: "partial", label: "Partial" },
            { value: "credit", label: "Credit" }
          ]}
          placeholder="All status"
          searchPlaceholder="Search status..."
          className="w-full sm:w-40"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="From date"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-40"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="To date"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-40"
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="soft" onClick={exportExcel} disabled={filtered.length === 0}>
            <FileSpreadsheet className="h-4 w-4" /> Export Excel
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New Sale
          </Button>
        </div>
      </div>

      <Card className="!p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : error ? (
          <p className="p-5 text-sm text-rose-600">Failed to load sales: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <ShoppingCart className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No sales yet</p>
            <p className="mt-1 text-sm text-slate-500">Record your first sale to start tracking revenue.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 sm:px-5">Invoice</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Customer</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Date</th>
                    <th className="hidden px-3 py-3 sm:table-cell">Payment</th>
                    <th className="px-3 py-3 text-right">Total</th>
                    <th className="px-3 py-3 text-right">Paid</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right sm:px-5">—</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((s) => (
                    <tr key={s.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                      <td className="px-3 py-3 sm:px-5">
                        <p className="font-mono font-semibold text-indigo-600">{s.invoice_no}</p>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-800 sm:table-cell">{s.customer || "Walk-in"}</td>
                      <td className="hidden px-3 py-3 text-slate-500 sm:table-cell">{fmtDateTime(s.created_at)}</td>
                      <td className="hidden px-3 py-3 capitalize text-slate-600 sm:table-cell">{s.payment_method}</td>
                      <td className="px-3 py-3 text-right font-bold text-slate-800">{fmtMoney(s.total)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{fmtMoney(s.paid)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[s.status] || "bg-slate-100 text-slate-600"}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right sm:px-5">
                        <div className="flex items-center justify-end gap-1">
                          <div className="relative">
                            <button
                              onClick={() => setPrintFor((p) => (p === s.id ? null : s.id))}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                              aria-label="Print"
                            >
                              <Printer className="h-4 w-4" />
                            </button>
                            {printFor === s.id && (
                              <>
                                <div className="fixed inset-0 z-30" onClick={() => setPrintFor(null)} />
                                <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                                  <button
                                    onClick={() => {
                                      setPrintFor(null);
                                      doPrint(s.id, "thermal");
                                    }}
                                    className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
                                  >
                                    Receipt (58mm)
                                  </button>
                                  <button
                                    onClick={() => {
                                      setPrintFor(null);
                                      doPrint(s.id, "a4");
                                    }}
                                    className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
                                  >
                                    Invoice (A4)
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                          <button
                            onClick={() => setViewSale(s)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                            aria-label="View"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => doWhatsApp(s)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                            aria-label="Send on WhatsApp"
                            title="Send bill on WhatsApp"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setToDelete(s)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 sm:hidden">
              {pageRows.map((s) => (
                <div key={s.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono font-semibold text-indigo-600">{s.invoice_no}</p>
                      <p className="mt-0.5 truncate text-sm text-slate-800">{s.customer || "Walk-in"}</p>
                      <p className="truncate text-[11px] capitalize text-slate-400">
                        {fmtDateTime(s.created_at)} · {s.payment_method}
                      </p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[s.status] || "bg-slate-100 text-slate-600"}`}>
                      {s.status}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-bold text-slate-800">{fmtMoney(s.total)}</span>
                      <span className="text-[11px] text-slate-400">paid {fmtMoney(s.paid)}</span>
                    </div>
                    <div className="relative flex items-center gap-1">
                      <div className="relative">
                        <button
                          onClick={() => setPrintFor((p) => (p === s.id ? null : s.id))}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                          aria-label="Print"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        {printFor === s.id && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setPrintFor(null)} />
                            <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                              <button
                                onClick={() => {
                                  setPrintFor(null);
                                  doPrint(s.id, "thermal");
                                }}
                                className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
                              >
                                Receipt (58mm)
                              </button>
                              <button
                                onClick={() => {
                                  setPrintFor(null);
                                  doPrint(s.id, "a4");
                                }}
                                className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
                              >
                                Invoice (A4)
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => setViewSale(s)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                        aria-label="View"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => doWhatsApp(s)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                        aria-label="Send on WhatsApp"
                        title="Send bill on WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setToDelete(s)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && !error && filtered.length > 0 && (
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        )}
      </Card>

      {open && (
        <NewSaleModal
          products={products}
          customers={customers}
          units={units}
          onSave={handleCreate}
          onClose={() => setOpen(false)}
          saving={saving}
        />
      )}

      {viewSale && (
        <ViewSaleModal
          sale={viewSale}
          onClose={() => setViewSale(null)}
          onUpdateStatus={handleUpdateStatus}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete sale?"
        message={`"${toDelete?.invoice_no}" and its items will be permanently removed. Stock will be restored.`}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function NewSaleModal({ products, customers, units, onSave, onClose, saving }) {
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [status, setStatus] = useState("paid");
  const [note, setNote] = useState("");
  const [items, setItems] = useState([]);
  const [quickAdd, setQuickAdd] = useState("");
  const [error, setError] = useState(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherApp, setVoucherApp] = useState(null);
  const [voucherErr, setVoucherErr] = useState(null);
  const [checking, setChecking] = useState(false);

  const unitMap = useMemo(() => {
    const m = {};
    units.forEach((u) => { m[u.id] = u; });
    return m;
  }, [units]);

  const sellable = useMemo(() => products.filter((p) => Number(p.selling_price) > 0), [products]);

  const getProduct = (id) => products.find((p) => String(p.id) === String(id));

  const updateItem = (idx, field, val) => {
    setItems((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const bumpQty = (idx, delta) => {
    const it = items[idx];
    if (!it) return;
    const next = Math.max(0.01, Math.round(((Number(it.qty) || 1) + delta) * 100) / 100);
    updateItem(idx, "qty", String(next));
  };

  const handleRowProduct = (idx, pid) => {
    const prod = products.find((p) => String(p.id) === String(pid));
    updateItem(idx, "product_id", pid);
    if (prod && prod.unit_id) updateItem(idx, "sale_unit_id", String(prod.unit_id));
  };

  const quickSelect = (pid) => {
    const prod = products.find((p) => String(p.id) === String(pid));
    setQuickAdd("");
    if (!prod) return;
    setItems((prev) => {
      const existing = prev.find(
        (it) => String(it.product_id) === String(pid) && String(it.sale_unit_id || "") === String(prod.unit_id || "")
      );
      if (existing) {
        return prev.map((it) =>
          it === existing ? { ...it, qty: String(Math.round(((Number(it.qty) || 1) + 1) * 100) / 100) } : it
        );
      }
      return [...prev, { product_id: String(pid), qty: "1", sale_unit_id: String(prod.unit_id || "") }];
    });
  };

  const finalPriceOf = (p) => {
    if (!p) return 0;
    const base = Math.max((Number(p.selling_price) || 0) - (Number(p.discount) || 0), 0);
    return Math.round((base + (base * (Number(p.tax) || 0)) / 100) * 100) / 100;
  };

  const priceOf = (it) => finalPriceOf(getProduct(it.product_id));
  const stockOf = (it) => Number(getProduct(it.product_id)?.stock) || 0;
  const marketOf = (it) => Number(getProduct(it.product_id)?.market_price) || 0;

  const lineTotal = (it) => priceOf(it) * (Number(it.qty) || 0);

  const lineSave = (it) => {
    const savePerUnit = Math.max(0, marketOf(it) - priceOf(it));
    return Math.round(savePerUnit * Number(it.qty) * 100) / 100;
  };

  const total = items.reduce((a, it) => a + lineTotal(it), 0);
  const totalSaved = Math.round(items.reduce((a, it) => a + lineSave(it), 0) * 100) / 100;
  const itemCount = items.reduce((a, it) => a + (Number(it.qty) || 0), 0);

  const voucherDiscount = useMemo(() => {
    if (!voucherApp) return 0;
    return voucherApp.discount_type === "percent"
      ? Math.round((total * voucherApp.discount_value) / 100 * 100) / 100
      : Math.min(voucherApp.discount_value, total);
  }, [voucherApp, total]);

  const grandTotal = Math.max(0, Math.round((total - voucherDiscount) * 100) / 100);

  const applyVoucher = async () => {
    const code = voucherCode.trim();
    if (!/^\d{4}$/.test(code)) {
      setVoucherErr("Enter the 4-digit code");
      setVoucherApp(null);
      return;
    }
    setChecking(true);
    setVoucherErr(null);
    try {
      const saleTotal = Math.round(total * 100) / 100;
      const res = await api.validateVoucher(code, saleTotal);
      if (!res.valid) {
        setVoucherApp(null);
        setVoucherErr(res.error || "Invalid voucher code");
      } else {
        setVoucherApp({
          code: res.voucher.code,
          campaign_name: res.voucher.campaign_name,
          discount_type: res.voucher.discount_type,
          discount_value: Number(res.voucher.discount_value),
          min_total: Number(res.voucher.min_total) || 0,
          months: Number(res.voucher.months) || 0,
          remaining_uses: res.voucher.remaining_uses,
          used_this_month: res.voucher.used_this_month,
          valid_through: res.voucher.valid_through
        });
        setVoucherCode("");
      }
    } catch (e) {
      setVoucherErr(e.message);
    } finally {
      setChecking(false);
    }
  };

  const productOptions = useMemo(
    () => [
      { value: "", label: "Select product" },
      ...sellable.map((p) => ({
        value: p.id,
        label: `${p.name} — ${fmtMoney(finalPriceOf(p))}${Number(p.stock) <= 0 ? " · out of stock" : ` · stock ${Math.round(p.stock)}`}`
      }))
    ],
    [sellable]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validItems = items.filter((it) => it.product_id);
    if (validItems.length === 0) {
      setError("Add at least one product");
      return;
    }
    try {
      await onSave({
        customer_id: customerId || null,
        payment_method: paymentMethod,
        status,
        note: note.trim() || null,
        voucher_code: voucherApp ? voucherApp.code : null,
        items: validItems.map((it) => ({
          product_id: Number(it.product_id),
          qty: Number(it.qty) || 1,
          sale_unit_id: it.sale_unit_id || null
        }))
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const renderProductCell = (it, idx) => {
    const overStock = it.product_id && Number(it.qty) > stockOf(it);
    return (
      <div className="min-w-0 flex-1">
        <SearchableSelect
          value={it.product_id}
          onChange={(e) => handleRowProduct(idx, e.target.value)}
          options={productOptions}
          placeholder="Select product"
          searchPlaceholder="Search products..."
        />
        {overStock && <p className="mt-1 text-[11px] font-medium text-amber-600">Only {Math.round(stockOf(it))} in stock</p>}
      </div>
    );
  };

  const renderQty = (it, idx) => {
    const unit = it.sale_unit_id ? unitMap[it.sale_unit_id] : null;
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => bumpQty(idx, -1)}
            className="px-2 py-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
            aria-label="Decrease"
          >
            <Minus className="h-4 w-3.5" />
          </button>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={it.qty}
            onChange={(e) => updateItem(idx, "qty", e.target.value)}
            className="w-14 border-x border-slate-200 py-1.5 text-center text-sm text-slate-800 outline-none focus:bg-indigo-50/40"
          />
          <button
            type="button"
            onClick={() => bumpQty(idx, 1)}
            className="px-2 py-1.5 text-slate-500 transition hover:bg-slate-100"
            aria-label="Increase"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {unit && <span className="w-8 text-xs font-medium text-slate-400">{unit.short_name}</span>}
      </div>
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New Sale"
      subtitle="Search and add products to build the bill"
      wide
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {items.length} line{items.length === 1 ? "" : "s"} · total qty {itemCount}
            </p>
            {totalSaved > 0 && (
              <p className="text-xs font-semibold text-emerald-600">Saves vs MRP {fmtMoney(totalSaved)}</p>
            )}
            {voucherApp && (
              <p className="text-xs font-semibold text-indigo-600">
                Voucher {voucherApp.code} · {voucherApp.campaign_name} · −{fmtMoney(voucherDiscount)} off
              </p>
            )}
            {voucherApp && total !== grandTotal ? (
              <p className="text-lg font-bold tracking-tight text-slate-900">
                <span className="text-sm font-medium text-slate-400 line-through">{fmtMoney(total)}</span> {fmtMoney(grandTotal)}
              </p>
            ) : (
              <p className="text-lg font-bold tracking-tight text-slate-900">{fmtMoney(grandTotal)}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="new-sale-form" disabled={saving}>
              <ShoppingCart className="h-4 w-4" />
              {saving ? "Saving…" : "Create Sale"}
            </Button>
          </div>
        </div>
      }
    >
      <form id="new-sale-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer">
            <SearchableSelect
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              options={[{ value: "", label: "Walk-in (no customer)" }, ...customers.map((c) => ({ value: c.id, label: c.name }))]}
              placeholder="Walk-in (no customer)"
              searchPlaceholder="Search customers..."
            />
          </Field>
          <Field label="Payment method">
            <SearchableSelect
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              options={METHODS}
              placeholder="Select method"
              searchPlaceholder="Search methods..."
            />
          </Field>
          <Field label="Status">
            <SearchableSelect
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: "paid", label: "Paid" },
                { value: "partial", label: "Partial" },
                { value: "credit", label: "Credit" }
              ]}
              placeholder="Select status"
              searchPlaceholder="Search status..."
            />
          </Field>
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" />
          </Field>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-indigo-500" />
              <p className="text-sm font-semibold text-slate-700">Voucher discount</p>
            </div>
            {voucherApp ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  <BadgeCheck className="h-3.5 w-3.5" /> {voucherApp.code} · {voucherApp.discount_type === "percent" ? `${voucherApp.discount_value}% off` : `Rs ${voucherApp.discount_value} off`} · {voucherApp.campaign_name}
                  {Number(voucherApp.min_total) > 0 ? ` · min ${fmtMoney(voucherApp.min_total)}` : ""}
                  {voucherApp.months > 0 ? ` · ${voucherApp.remaining_uses} use${voucherApp.remaining_uses === 1 ? "" : "s"} left` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setVoucherApp(null)}
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Remove voucher"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
          {!voucherApp && (
            <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-2">
                <input
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onKeyDown={(e) => e.key === "Enter" && applyVoucher()}
                  inputMode="numeric"
                  placeholder="Enter 4-digit voucher code from bill"
                  className="w-full max-w-xs flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm tracking-[0.4em] outline-none transition focus:border-indigo-400"
                />
                <Button type="button" variant="soft" onClick={applyVoucher} disabled={checking}>
                  {checking ? "Checking…" : "Apply"}
                </Button>
              </div>
            </div>
          )}
          {voucherErr && <p className="mt-2 text-xs font-medium text-rose-600">{voucherErr}</p>}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <p className="text-sm font-semibold text-slate-700">Add Products</p>
            <span className="text-[11px] font-medium text-slate-400">Pick a product to add it to the bill</span>
          </div>

          <SearchableSelect
            value={quickAdd}
            onChange={(e) => quickSelect(e.target.value)}
            options={[{ value: "", label: "Select a product to add" }, ...productOptions.filter((o) => o.value !== "")]}
            placeholder="Search & add a product…"
            searchPlaceholder="Type to search products…"
            className="w-full"
          />

          {items.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 py-10 text-center">
              <ShoppingCart className="h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-600">No items added yet</p>
              <p className="mt-0.5 text-xs text-slate-400">Search above and pick a product to start billing.</p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-2xl border border-slate-200 md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2.5">Product</th>
                      <th className="px-3 py-2.5">Qty</th>
                      <th className="w-40 px-3 py-2.5">Unit</th>
                      <th className="px-3 py-2.5 text-right">MRP</th>
                      <th className="px-3 py-2.5 text-right">Rate</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                      <th className="w-12 px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((it, idx) => {
                      const p = getProduct(it.product_id);
                      const overStock = it.product_id && Number(it.qty) > stockOf(it);
                      return (
                        <tr key={idx} className={overStock ? "bg-amber-50/50" : ""}>
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-start gap-2">
                              <span className="mt-2 w-5 shrink-0 text-center text-xs font-semibold text-slate-300">{idx + 1}</span>
                              <div className="min-w-0 flex-1">{renderProductCell(it, idx)}</div>
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">{renderQty(it, idx)}</td>
                          <td className="px-3 py-2 align-top">
                            <SearchableSelect
                              value={it.sale_unit_id}
                              onChange={(e) => updateItem(idx, "sale_unit_id", e.target.value)}
                              options={[{ value: "", label: "Unit" }, ...units.map((u) => ({ value: u.id, label: u.short_name }))]}
                              placeholder="Unit"
                              searchPlaceholder="Search units..."
                            />
                          </td>
                          <td className="px-3 py-2 text-right align-top">
                            {marketOf(it) > 0 ? (
                              <span className="text-slate-400">{fmtMoney(marketOf(it))}</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right align-top text-slate-600">{p ? fmtMoney(priceOf(it)) : "—"}</td>
                          <td className="px-3 py-2 text-right align-top">
                            <p className={`font-bold ${overStock ? "text-amber-600" : "text-slate-800"}`}>
                              {p ? fmtMoney(lineTotal(it)) : "—"}
                            </p>
                            {p && lineSave(it) > 0 && (
                              <p className="text-[11px] font-semibold text-emerald-600">save {fmtMoney(lineSave(it))}</p>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                              aria-label="Remove item"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 md:hidden">
                {items.map((it, idx) => {
                  const p = getProduct(it.product_id);
                  const overStock = it.product_id && Number(it.qty) > stockOf(it);
                  return (
                    <div key={idx} className={`rounded-2xl border p-3 shadow-sm ${overStock ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">{renderProductCell(it, idx)}</div>
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                          aria-label="Remove item"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        {renderQty(it, idx)}
                        <SearchableSelect
                          value={it.sale_unit_id}
                          onChange={(e) => updateItem(idx, "sale_unit_id", e.target.value)}
                          options={[{ value: "", label: "Unit" }, ...units.map((u) => ({ value: u.id, label: u.short_name }))]}
                          placeholder="Unit"
                          searchPlaceholder="Search units..."
                          className="w-32"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                        <div className="flex flex-wrap gap-2">
                          {p && marketOf(it) > 0 && (
                            <span className="text-slate-400">MRP: <span className="font-semibold text-slate-600">{fmtMoney(marketOf(it))}</span></span>
                          )}
                          <span className="text-slate-500">Rate: <span className="font-semibold text-slate-700">{p ? fmtMoney(priceOf(it)) : "—"}</span></span>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-slate-800">{p ? fmtMoney(lineTotal(it)) : "—"}</p>
                          {p && lineSave(it) > 0 && (
                            <p className="text-[11px] font-semibold text-emerald-600">save {fmtMoney(lineSave(it))}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}

function ViewSaleModal({ sale, onClose, onUpdateStatus }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.sale(sale.id);
        setItems(data.items || []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [sale.id]);

  const subtotal = items.reduce((a, it) => a + (Number(it.unit_price) * Number(it.qty)), 0);
  const totalProfit = items.reduce((a, it) => a + (Number(it.profit) || 0), 0);
  const totalSaved = items.reduce((a, it) => {
    const savePerUnit = Math.max(0, (Number(it.market_price) || 0) - (Number(it.unit_price) || 0));
    return a + savePerUnit * Number(it.qty);
  }, 0);
  const paid = Number(sale.paid) || 0;
  const total = Number(sale.total) || subtotal;
  const discount = Math.max(0, subtotal - total);
  const outstanding = total - paid;

  return (
    <Modal open onClose={onClose} title={`Invoice ${sale.invoice_no}`} subtitle="Sale details and receipt" wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Customer</p>
            <p className="font-semibold text-slate-800">{sale.customer || "Walk-in"}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Date</p>
            <p className="font-semibold text-slate-800">{fmtDateTime(sale.created_at)}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Payment</p>
            <p className="font-semibold capitalize text-slate-800">{sale.payment_method}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Status</p>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[sale.status] || ""}`}>
              {sale.status}
            </span>
          </div>
        </div>

        <Card className="!p-0">
          {loading ? (
            <div className="p-4 text-sm text-slate-400">Loading items…</div>
          ) : items.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">No items found</div>
          ) : (
            <>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase text-slate-400">
                      <th className="px-4 py-2">Product</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                      <th className="px-4 py-2 text-right">Price</th>
                      <th className="px-4 py-2 text-right">MRP</th>
                      <th className="px-4 py-2 text-right">Cost</th>
                      <th className="px-4 py-2 text-right">Profit</th>
                      <th className="px-4 py-2">HSN</th>
                      <th className="px-4 py-2 text-right">Tax %</th>
                      <th className="px-4 py-2 text-right">Tax Amt</th>
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id} className="border-b border-slate-50">
                        <td className="px-4 py-2">
                          <p className="font-medium text-slate-800">{it.product_name}</p>
                          {it.pack_status && (
                            <p className="text-[11px] text-slate-400">
                              Pack: {it.pack_status === "closed" ? "Full" : it.pack_status === "open" ? `Open (${it.pack_remaining} remaining)` : "Empty"}
                              {it.pack_supplier ? ` from ${it.pack_supplier}` : ""}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-600">{it.qty} {it.unit_name || ""}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{fmtMoney(it.unit_price)}</td>
                        <td className="px-4 py-2 text-right text-slate-400">
                          {Number(it.market_price) > 0 ? fmtMoney(it.market_price) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-500">{fmtMoney(it.purchase_price)}</td>
                        <td className="px-4 py-2 text-right font-semibold text-emerald-600">{fmtMoney(it.profit)}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{it.hsn_code || "—"}</td>
                        <td className="px-4 py-2 text-right text-slate-500">{Number(it.tax) ? `${it.tax}%` : "—"}</td>
                        <td className="px-4 py-2 text-right text-slate-500">{Number(it.tax_amt) ? fmtMoney(it.tax_amt) : "—"}</td>
                        <td className="px-4 py-2 text-right font-semibold text-slate-800">{fmtMoney(Number(it.unit_price) * Number(it.qty))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-4 sm:hidden">
                {items.map((it) => (
                  <div key={it.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-slate-800">{it.product_name}</p>
                        {it.pack_status && (
                          <p className="text-[11px] text-slate-400">
                            Pack: {it.pack_status === "closed" ? "Full" : it.pack_status === "open" ? `Open (${it.pack_remaining} remaining)` : "Empty"}
                          </p>
                        )}
                      </div>
                      <p className="font-bold text-slate-800">{fmtMoney(Number(it.unit_price) * Number(it.qty))}</p>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <span>Qty: {it.qty} {it.unit_name || ""}</span>
                      <span>Price: {fmtMoney(it.unit_price)}</span>
                      <span>MRP: {Number(it.market_price) > 0 ? fmtMoney(it.market_price) : "—"}</span>
                      <span>Cost: {fmtMoney(it.purchase_price)}</span>
                      <span>Profit: <span className="font-semibold text-emerald-600">{fmtMoney(it.profit)}</span></span>
                      <span>HSN: {it.hsn_code || "—"}</span>
                      <span>Tax: {Number(it.tax) ? `${it.tax}%` : "—"} · {Number(it.tax_amt) ? fmtMoney(it.tax_amt) : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Subtotal</span>
            <span className="font-semibold text-slate-800">{fmtMoney(subtotal)}</span>
          </div>
          {totalSaved > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">You saved vs MRP</span>
              <span className="font-semibold text-emerald-600">{fmtMoney(totalSaved)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">Profit</span>
            <span className="font-semibold text-emerald-600">{fmtMoney(Math.max(0, totalProfit - discount))}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Discount (voucher)</span>
              <span className="font-semibold text-rose-600">− {fmtMoney(discount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2">
            <span className="font-semibold text-slate-700">Total</span>
            <span className="text-lg font-bold text-slate-900">{fmtMoney(total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Paid</span>
            <span className="font-semibold text-emerald-600">{fmtMoney(paid)}</span>
          </div>
          {outstanding > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Outstanding</span>
              <span className="font-semibold text-rose-600">{fmtMoney(outstanding)}</span>
            </div>
          )}
          {sale.note && (
            <div className="pt-2 text-xs text-slate-500">
              <span className="font-medium">Note:</span> {sale.note}
            </div>
          )}
        </div>

        {outstanding > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={() => onUpdateStatus(sale.id, "paid", Number(sale.total))}
              className="!bg-emerald-50 !text-emerald-700 hover:!bg-emerald-100"
            >
              <CreditCard className="h-4 w-4" /> Mark Paid
            </Button>
            <Button
              variant="ghost"
              onClick={() => onUpdateStatus(sale.id, "partial", Math.round(Number(sale.total) / 2))}
              className="!bg-amber-50 !text-amber-700 hover:!bg-amber-100"
            >
              Partial Payment
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="soft" onClick={() => printReceipt(sale, items, getStoreInfo())}>
              <Printer className="h-4 w-4" /> Receipt (58mm)
            </Button>
            <Button variant="soft" onClick={() => printInvoiceA4(sale, items, getStoreInfo())}>
              <FileText className="h-4 w-4" /> Invoice (A4)
            </Button>
            <Button
              variant="soft"
              onClick={() => sendWhatsApp(buildSaleWhatsAppText(getStoreInfo(), sale, items), sale.customer_phone)}
              className="!bg-emerald-50 !text-emerald-700 hover:!bg-emerald-100"
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </Button>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}