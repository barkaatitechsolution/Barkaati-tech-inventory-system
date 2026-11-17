import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { Plus, Search, Trash2, Receipt, Eye, X, ChevronDown, FileDown, Check, Wallet, Paperclip, Pencil } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DraftBanner from "../components/DraftBanner.jsx";
import { Field, Input, Button } from "../components/Field.jsx";
import { useFormDraft, useDraftReopen, deleteDraft } from "../lib/formDraft.js";
import SearchableSelect from "../components/SearchableSelect.jsx";
import BarcodeScanInput from "../components/BarcodeScanInput.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney, fmtDateTime, fmtDate, fmtQty } from "../lib/format.js";
import { printSupplierPurchaseBills } from "../lib/receipt.js";
import { getStoreInfo } from "../lib/storeInfo.js";

const PAGE_SIZE = 20;
const MAX_BILL_IMAGES = 10;

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const dateOnly = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

// The server sends timestamps in the shop's local time; <input type="datetime-local">
// wants the same wall-clock reading as "YYYY-MM-DDTHH:mm", so rebuild it field by
// field instead of toISOString() (which would shift it to UTC first).
const toLocalInput = (d) => {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
};

const payStatus = (r) => {
  const total = Number(r.grand_total) || 0;
  const paid = Number(r.paid_amount) || 0;
  const due = Math.max(0, total - paid);
  const dueDate = dateOnly(r.due_date);
  const overdue = due > 0 && dueDate && dueDate < todayStr();
  if (due <= 0) return { key: "paid", label: "Paid", color: "bg-emerald-50 text-emerald-700", due };
  if (overdue) return { key: "overdue", label: "Overdue", color: "bg-rose-50 text-rose-600", due };
  if (paid > 0) return { key: "partial", label: "Partial", color: "bg-sky-50 text-sky-700", due };
  return { key: "credit", label: "Credit", color: "bg-amber-50 text-amber-700", due };
};

const EMPTY_ITEM = {
  item_name: "",
  product_id: "",
  unit_id: "",
  purchase_price: "",
  selling_price: "",
  quantity: "1",
  pack_size: "1",
  pack_sub_unit: "",
  hsn_code: "",
  tax: "",
  discount: ""
};

export default function SupplierPurchases() {
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [open, setOpen] = useState(false);
  const [viewPurchase, setViewPurchase] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [loadingExpand, setLoadingExpand] = useState(false);
  const expandToken = useRef(null);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [payFor, setPayFor] = useState(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [editPurchase, setEditPurchase] = useState(null);
  const [loadingEdit, setLoadingEdit] = useState(false);

  useDraftReopen({
    prefix: "purchases",
    open,
    onReopen: () => setOpen(true)
  });

  useDraftReopen({
    prefix: "purchase-payment",
    open: !!payFor,
    session: payFor,
    onReopen: (session) => setPayFor(session || null)
  });

  useDraftReopen({
    prefix: "purchase-edit",
    open: !!editPurchase,
    session: editPurchase?.id ?? null,
    onReopen: (session) => {
      if (session) openEdit({ id: session });
    }
  });

  const load = async () => {
    setLoading(true);
    try {
      const [p, s, u, it] = await Promise.all([
        api.supplierPurchases(),
        api.suppliers(),
        api.measuringUnits(),
        api.items()
      ]);
      setRows(p);
      setSuppliers(s);
      setUnits(u);
      setItems(it);
      setExpandedData(null);
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

  const mergeProducts = useCallback((incoming) => {
    const list = (Array.isArray(incoming) ? incoming : [incoming]).filter(Boolean);
    if (!list.length) return;
    setProducts((prev) => {
      const map = new Map(prev.map((p) => [String(p.id), p]));
      for (const row of list) map.set(String(row.id), { ...(map.get(String(row.id)) || {}), ...row });
      return [...map.values()];
    });
  }, []);

  const searchProducts = useCallback(async (query) => {
    const rows = await api.productSearch(query, 30);
    mergeProducts(rows);
    return rows;
  }, [mergeProducts]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    return rows.filter((r) => {
      const matchesQuery =
        !q ||
        [r.supplier_name, r.supplier_company, r.item_names]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q));
      const ts = new Date(r.purchased_at).getTime();
      const matchesDate = (!from || ts >= from) && (!to || ts <= to);
      const matchesStatus = statusFilter === "all" || payStatus(r).key === statusFilter;
      const matchesSupplier = !supplierFilter || String(r.supplier_id) === String(supplierFilter);
      return matchesQuery && matchesDate && matchesStatus && matchesSupplier;
    });
  }, [rows, debouncedSearch, dateFrom, dateTo, statusFilter, supplierFilter]);

  const listStats = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        const st = payStatus(r);
        acc.due += st.due;
        acc.paid += Number(r.paid_amount) || 0;
        if (st.key === "overdue") acc.overdue++;
        return acc;
      },
      { due: 0, paid: 0, overdue: 0 }
    );
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, dateFrom, dateTo, statusFilter, supplierFilter]);

  const openCreate = () => setOpen(true);

  const downloadBillsPdf = async () => {
    if (filtered.length === 0) {
      setToast("No purchases in the selected range");
      return;
    }
    setLoadingPdf(true);
    try {
      const details = await Promise.all(filtered.map((r) => api.supplierPurchase(r.id)));
      printSupplierPurchaseBills(getStoreInfo(), details, { from: dateFrom, to: dateTo });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPdf(false);
    }
  };

  const toggleExpand = async (id) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (expandedData?.id === id) return;
    const token = Symbol("expand");
    expandToken.current = token;
    setLoadingExpand(true);
    try {
      const data = await api.supplierPurchase(id);
      if (expandToken.current === token) setExpandedData({ id, items: data.items || [] });
    } catch {
      if (expandToken.current === token) setExpandedData({ id, items: [] });
    } finally {
      if (expandToken.current === token) setLoadingExpand(false);
    }
  };


  const handleCreate = async (data) => {
    setSaving(true);
    try {
      await api.createSupplierPurchase(data);
      await deleteDraft("purchases:new");
      setOpen(false);
      setToast("Purchase recorded");
      await load();
    } catch (err) {
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const openEdit = async (r) => {
    setLoadingEdit(true);
    try {
      const detail = await api.supplierPurchase(r.id);
      setEditPurchase(detail);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingEdit(false);
    }
  };

  const handleUpdate = async (id, data) => {
    setSaving(true);
    try {
      await api.updateSupplierPurchase(id, data);
      await deleteDraft(`purchases:edit:${id}`);
      setEditPurchase(null);
      setViewPurchase(null);
      setToast("Purchase updated");
      await load();
    } catch (err) {
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.deleteSupplierPurchase(toDelete.id);
      setToDelete(null);
      setToast("Purchase deleted");
      await load();
    } catch (err) {
      setError(err.message);
      setToDelete(null);
    }
  };

  const markPaid = async (r) => {
    try {
      await api.updateSupplierPayment(r.id, {
        paid_amount: Number(r.grand_total) || 0,
        due_date: dateOnly(r.due_date) || null
      });
      setToast("Marked as paid");
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier, product…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="From date"
          className="sm:w-40"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="To date"
          className="sm:w-40"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          title="Filter by payment status"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-36"
        >
          <option value="all">All status</option>
          <option value="credit">Credit</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          title="Filter by supplier"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-44"
        >
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button variant="soft" onClick={downloadBillsPdf} disabled={filtered.length === 0 || loadingPdf}>
          <FileDown className="h-4 w-4" /> {loadingPdf ? "Preparing…" : "Download all bills (PDF)"}
        </Button>
        <div className="ml-auto">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Purchase
          </Button>
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
            Credit outstanding {fmtMoney(listStats.due)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
            Paid {fmtMoney(listStats.paid)}
          </span>
          {listStats.overdue > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-600">
              {listStats.overdue} overdue
            </span>
          )}
        </div>
      )}

      <Card className="!p-0">
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-50" />
            ))}
          </div>
        ) : error ? (
          <p className="p-5 text-sm text-rose-600">Failed to load purchases: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Receipt className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No purchases found</p>
            <p className="mt-1 text-sm text-slate-500">Record a supplier purchase to track inventory.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {pageRows.map((r) => {
              const isOpen = expanded === r.id;
              const status = payStatus(r);
              const paid = Number(r.paid_amount) || 0;
              const grand = Number(r.grand_total) || 0;
              const paidPct = grand > 0 ? Math.min(100, Math.round((paid / grand) * 100)) : 0;
              const items = expandedData?.id === r.id ? expandedData.items : [];
              const bar = { paid: "bg-emerald-500", partial: "bg-sky-500", credit: "bg-amber-500", overdue: "bg-rose-500" };
              const imageCount =
                Number(r.bill_image_count) || (r.bill_image ? 1 : 0);
              return (
                <div
                  key={r.id}
                  className={`group relative overflow-hidden rounded-xl border transition-colors duration-200 ${
                    isOpen
                      ? "border-indigo-200 bg-indigo-50/40"
                      : "border-slate-200/80 bg-white hover:bg-slate-50/70"
                  }`}
                >
                  <span
                    className={`absolute inset-y-0 left-0 w-[3px] bg-indigo-500 transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 py-3.5 pl-3 pr-4 text-left sm:gap-4 sm:pl-4 sm:pr-5"
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-300 ${
                        isOpen
                          ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30"
                          : "bg-slate-100 text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600"
                      }`}
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate font-semibold text-slate-800">{r.supplier_name || "Unknown supplier"}</p>
                        {r.invoice_no && (
                          <span className="inline-flex items-center rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                            {r.invoice_no}
                          </span>
                        )}
                        {imageCount > 0 && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                            title={`${imageCount} bill ${imageCount === 1 ? "image" : "images"}`}
                          >
                            <Paperclip className="h-2.5 w-2.5" />
                            {imageCount === 1 ? "Bill" : `Bill ×${imageCount}`}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {r.item_count || 0} {r.item_count === 1 ? "item" : "items"} · {fmtDateTime(r.purchased_at)}
                        {status.due > 0 && (
                          <span className="font-semibold text-amber-600">
                            {" · "}Due {fmtMoney(status.due)}
                            {r.due_date ? ` (${fmtDate(r.due_date)})` : ""}
                          </span>
                        )}
                      </p>
                      {grand > 0 && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1 w-24 overflow-hidden rounded-full bg-slate-200/80">
                            <div
                              className={`h-full rounded-full transition-[width] duration-500 ease-out ${bar[status.key]}`}
                              style={{ width: `${paidPct}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-medium tabular-nums text-slate-400">
                            {paidPct}% paid
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end">
                      <p className="font-bold tabular-nums text-slate-800">{fmtMoney(grand)}</p>
                      <span
                        className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${status.color}`}
                      >
                        {status.label}
                      </span>
                    </div>
                  </button>

                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                      isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="mx-3 mb-3 mt-1 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm sm:mx-4 sm:p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                          <div className="min-w-0 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${status.color}`}>
                                {status.label}
                              </span>
                              <span className="text-slate-400">
                                Paid {fmtMoney(paid)} of {fmtMoney(grand)}
                                {r.due_date ? ` · Reminder ${fmtDate(r.due_date)}` : ""}
                              </span>
                            </div>
                            {status.due > 0 && (
                              <p className="mt-1 text-sm font-semibold text-amber-600">
                                Balance {fmtMoney(status.due)}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            {status.due > 0 && (
                              <Button
                                variant="soft"
                                onClick={(e) => { e.stopPropagation(); markPaid(r); }}
                                className="!rounded-lg !px-3 !py-1.5 text-xs"
                              >
                                <Check className="h-3.5 w-3.5" /> Mark paid
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); setPayFor(r); }}
                              className="!rounded-lg !px-3 !py-1.5 text-xs"
                            >
                              <Wallet className="h-3.5 w-3.5" /> Payment / reminder
                            </Button>
                          </div>
                        </div>

                        {loadingExpand ? (
                          <div className="space-y-2 py-1">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-50" />
                            ))}
                          </div>
                        ) : items.length === 0 ? (
                          <p className="py-4 text-center text-sm text-slate-400">No items</p>
                        ) : (
                          <>
                            <div className="hidden grid-cols-[1fr_9rem_7rem] gap-3 px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
                              <span>Item</span>
                              <span className="text-right">Qty × Pack</span>
                              <span className="text-right">Amount</span>
                            </div>
                            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200/80">
                              {items.map((it) => {
                                const packSize = Number(it.pack_size) || 1;
                                const qty = Number(it.quantity) || 1;
                                const totalQty = qty * packSize;
                                const sub = (Number(it.purchase_price) || 0) * totalQty;
                                const taxAmt = (sub * (Number(it.tax) || 0)) / 100;
                                const lineT = sub + taxAmt - (Number(it.discount) || 0);
                                return (
                                  <div
                                    key={it.id}
                                    className="grid grid-cols-1 gap-1 px-3 py-2.5 text-sm transition hover:bg-slate-50/60 sm:grid-cols-[1fr_9rem_7rem] sm:items-center sm:gap-3"
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate font-medium text-slate-800">{it.product_name || it.item_name}</p>
                                      <p className="truncate text-xs text-slate-400">
                                        {it.purchase_price
                                          ? `@ ${fmtMoney(it.purchase_price)}/${it.pack_sub_unit || "unit"}`
                                          : "No rate"}
                                        {it.hsn_code ? ` · HSN ${it.hsn_code}` : ""}
                                        {(Number(it.tax) || 0) > 0 ? ` · Tax ${it.tax}%` : ""}
                                        {(Number(it.selling_price) || 0) > 0 ? ` · Sell ${fmtMoney(it.selling_price)}` : ""}
                                      </p>
                                    </div>
                                    <p className="text-xs text-slate-500 sm:text-right">
                                      {fmtQty(qty)} × {fmtQty(packSize)}
                                      <span className="text-slate-400">
                                        {it.pack_sub_unit ? ` ${it.pack_sub_unit}` : ""} = {fmtQty(totalQty)}
                                      </span>
                                    </p>
                                    <p className="text-sm font-bold tabular-nums text-slate-800 sm:text-right">
                                      {fmtMoney(lineT)}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-3 flex items-center justify-between rounded-xl bg-indigo-50 px-3.5 py-2.5 text-sm font-semibold ring-1 ring-indigo-100">
                              <span className="text-slate-600">Grand Total</span>
                              <span className="text-base tabular-nums text-indigo-700">{fmtMoney(grand)}</span>
                            </div>
                          </>
                        )}

                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                          <Button
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); setViewPurchase(r); }}
                            className="!rounded-lg !px-3 !py-1.5 text-xs"
                          >
                            <Eye className="h-3.5 w-3.5" /> Full details
                          </Button>
                          <Button
                            variant="soft"
                            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                            disabled={loadingEdit}
                            className="!rounded-lg !px-3 !py-1.5 text-xs"
                          >
                            <Pencil className="h-3.5 w-3.5" /> {loadingEdit ? "Loading…" : "Edit"}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); setToDelete(r); }}
                            className="!rounded-lg !px-3 !py-1.5 text-xs !text-rose-600 hover:!bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        )}

        {!loading && !error && filtered.length > 0 && (
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        )}
      </Card>

      {open && (
        <NewPurchaseModal
          suppliers={suppliers}
          products={products}
          units={units}
          items={items}
          onSave={handleCreate}
          onClose={() => setOpen(false)}
          saving={saving}
          onSearchProducts={searchProducts}
        />
      )}

      {editPurchase && (
        <NewPurchaseModal
          key={editPurchase.id}
          suppliers={suppliers}
          products={products}
          units={units}
          items={items}
          initial={editPurchase}
          onSave={(data) => handleUpdate(editPurchase.id, data)}
          onClose={() => setEditPurchase(null)}
          saving={saving}
          onSearchProducts={searchProducts}
        />
      )}

      {viewPurchase && (
        <ViewPurchaseModal
          purchaseId={viewPurchase.id}
          units={units}
          onClose={() => setViewPurchase(null)}
          onUpdatePayment={(p) => setPayFor(p)}
          onEdit={(p) => { setViewPurchase(null); openEdit(p); }}
        />
      )}

      {payFor && (
        <PaymentModal
          purchase={payFor}
          onClose={() => setPayFor(null)}
          onSaved={async () => {
            setPayFor(null);
            setToast("Payment updated");
            await load();
          }}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete purchase?"
        message={`This purchase and all its items will be permanently removed.`}
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

function NewPurchaseModal({ suppliers, products, units, items, onSave, onClose, saving, onSearchProducts, initial = null }) {
  const editing = initial || null;
  const editingId = editing?.id ?? null;

  // Editing prefills every field with what the purchase already carries, so
  // saving without touching anything rewrites the same numbers. Quantities are
  // stored totalled per pack, and feeding the stored pair back in reproduces
  // them exactly.
  const initialLineItems = editing?.items?.length
    ? editing.items.map((it) => ({
        item_name: it.item_name || "",
        product_id: it.product_id ? String(it.product_id) : "",
        unit_id: it.unit_id ? String(it.unit_id) : "",
        purchase_price: it.purchase_price ?? "",
        selling_price: it.selling_price ?? "",
        quantity: String(it.quantity ?? 1),
        pack_size: String(it.pack_size ?? 1),
        pack_sub_unit: it.pack_sub_unit || "",
        hsn_code: it.hsn_code || "",
        tax: it.tax ?? "",
        discount: it.discount ?? ""
      }))
    : null;
  const initialImages = Array.isArray(editing?.bill_images)
    ? editing.bill_images.filter(Boolean)
    : editing?.bill_image
      ? [editing.bill_image]
      : [];

  const [supplierId, setSupplierId] = useState(editing?.supplier_id ? String(editing.supplier_id) : "");
  const [purchasedAt, setPurchasedAt] = useState(editing?.purchased_at ? toLocalInput(editing.purchased_at) : nowLocal());
  const [invoiceNo, setInvoiceNo] = useState(editing?.invoice_no || "");
  const [billImages, setBillImages] = useState(initialImages);
  const [additionalCharges, setAdditionalCharges] = useState(
    editing && Number(editing.additional_charges) ? String(editing.additional_charges) : ""
  );
  const [payStatusVal, setPayStatusVal] = useState(() => {
    if (!editing) return "credit";
    const total = Number(editing.grand_total) || 0;
    const paid = Number(editing.paid_amount) || 0;
    return total > 0 && paid >= total ? "paid" : "credit";
  });
  const [paidAmount, setPaidAmount] = useState(
    editing && Number(editing.paid_amount) ? String(editing.paid_amount) : ""
  );
  const [dueDate, setDueDate] = useState(editing?.due_date ? dateOnly(editing.due_date) : "");
  const [lineItems, setLineItems] = useState(initialLineItems || [{ ...EMPTY_ITEM }]);
  const [extraProducts, setExtraProducts] = useState([]);
  const [remoteProducts, setRemoteProducts] = useState([]);
  const [error, setError] = useState(null);

  const allProducts = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of [...products, ...remoteProducts, ...extraProducts]) {
      const key = String(p.id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }, [products, remoteProducts, extraProducts]);

  const loadProductOptions = useCallback(
    async (query) => {
      const rows = await onSearchProducts(query);
      setRemoteProducts((prev) => {
        const map = new Map(prev.map((p) => [String(p.id), p]));
        for (const row of rows) map.set(String(row.id), row);
        return [...map.values()];
      });
      return rows.map((p) => ({
        value: String(p.id),
        label: p.name,
        searchText: p.name,
        keywords: [p.barcode, p.sku].filter(Boolean)
      }));
    },
    [onSearchProducts]
  );

  const draft = useFormDraft({
    key: editingId ? `purchases:edit:${editingId}` : "purchases:new",
    value: { supplierId, purchasedAt, invoiceNo, billImages, additionalCharges, payStatusVal, paidAmount, dueDate, lineItems },
    apply: (v) => {
      if (v.supplierId !== undefined) setSupplierId(v.supplierId);
      if (v.purchasedAt !== undefined) setPurchasedAt(v.purchasedAt);
      if (v.invoiceNo !== undefined) setInvoiceNo(v.invoiceNo);
      if (Array.isArray(v.billImages)) setBillImages(v.billImages);
      if (v.additionalCharges !== undefined) setAdditionalCharges(v.additionalCharges);
      if (v.payStatusVal !== undefined) setPayStatusVal(v.payStatusVal);
      if (v.paidAmount !== undefined) setPaidAmount(v.paidAmount);
      if (v.dueDate !== undefined) setDueDate(v.dueDate);
      if (Array.isArray(v.lineItems) && v.lineItems.length) setLineItems(v.lineItems);
    }
  });

  const unitMap = useMemo(() => {
    const m = {};
    units.forEach((u) => { m[u.id] = u; });
    return m;
  }, [units]);

  const addItem = () => setLineItems((prev) => [{ ...EMPTY_ITEM }, ...prev]);
  const removeItem = (idx) => {
    if (lineItems.length === 1) return;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };
  const updateItem = (idx, field, val) => {
    setLineItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const scanPurchaseProduct = async (code) => {
    setError(null);
    try {
      let prod = allProducts.find((p) => String(p.barcode) === String(code));
      if (!prod) prod = await api.productByBarcode(code);
      if (!allProducts.some((p) => String(p.id) === String(prod.id))) {
        setExtraProducts((prev) => [...prev, prod]);
      }
      setLineItems((prev) => {
        const existing = prev.findIndex((it) => String(it.product_id) === String(prod.id));
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = {
            ...next[existing],
            quantity: String(Math.round(((Number(next[existing].quantity) || 1) + 1) * 1000000) / 1000000)
          };
          return next;
        }
        const item = {
          ...EMPTY_ITEM,
          product_id: String(prod.id),
          item_name: prod.name,
          purchase_price: prod.purchase_price ?? "",
          selling_price: prod.selling_price ?? "",
          hsn_code: prod.hsn_code || "",
          unit_id: prod.unit_id ? String(prod.unit_id) : "",
          pack_sub_unit: prod.unit || ""
        };
        if (prev.length === 1 && !prev[0].product_id && !prev[0].item_name.trim()) return [item];
        return [item, ...prev];
      });
    } catch (e) {
      setError(e.message);
    }
  };

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    const room = MAX_BILL_IMAGES - billImages.length;
    if (room <= 0) {
      setError(`A purchase can carry at most ${MAX_BILL_IMAGES} bill images`);
      return;
    }
    if (files.length > room) {
      setError(`Only ${room} more ${room === 1 ? "image" : "images"} can be added (max ${MAX_BILL_IMAGES})`);
    }
    files.slice(0, room).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setBillImages((prev) => (prev.length >= MAX_BILL_IMAGES ? prev : [...prev, reader.result]));
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (idx) => {
    setBillImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalQtyOf = (it) =>
    (Number(it.quantity) || 1) * (Number(it.pack_size) || 1);

  const lineTotal = (it) => {
    const price = Number(it.purchase_price) || 0;
    const totalQty = totalQtyOf(it);
    const tax = Number(it.tax) || 0;
    const discount = Number(it.discount) || 0;
    const sub = price * totalQty;
    const taxAmt = (sub * tax) / 100;
    return sub + taxAmt - discount;
  };

  const lineSellingValue = (it) =>
    (Number(it.selling_price) || 0) * totalQtyOf(it);

  const lineProfit = (it) =>
    ((Number(it.selling_price) || 0) - (Number(it.purchase_price) || 0)) * totalQtyOf(it);

  const lineMargin = (it) => {
    const selling = Number(it.selling_price) || 0;
    if (selling <= 0) return 0;
    return (((selling - (Number(it.purchase_price) || 0)) / selling) * 100);
  };

  const itemsTotal = lineItems.reduce((a, it) => a + lineTotal(it), 0);
  const sellingTotal = lineItems.reduce((a, it) => a + lineSellingValue(it), 0);
  const expectedProfit = lineItems.reduce((a, it) => a + lineProfit(it), 0);
  const expectedMargin = sellingTotal > 0 ? (expectedProfit / sellingTotal) * 100 : 0;
  const charges = Number(additionalCharges) || 0;
  const grandTotal = itemsTotal + charges;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validItems = lineItems.filter((it) => it.item_name.trim());
    if (validItems.length === 0) {
      setError("Add at least one item with a name");
      return;
    }
    try {
      await onSave({
        supplier_id: supplierId || null,
        purchased_at: purchasedAt || null,
        invoice_no: invoiceNo.trim() || null,
        bill_images: billImages,
        additional_charges: charges,
        grand_total: grandTotal,
        paid_amount: payStatusVal === "paid" ? grandTotal : Number(paidAmount) || 0,
        due_date: dueDate || null,
        items: [...validItems].reverse().map((it) => ({
          item_name: it.item_name.trim(),
          product_id: it.product_id || null,
          unit_id: it.unit_id || null,
          purchase_price: Number(it.purchase_price) || 0,
          selling_price: Number(it.selling_price) || 0,
          quantity: Number(it.quantity) || 1,
          pack_size: Number(it.pack_size) || 1,
          pack_sub_unit: it.pack_sub_unit.trim() || null,
          hsn_code: it.hsn_code.trim() || null,
          tax: Number(it.tax) || 0,
          discount: Number(it.discount) || 0
        }))
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const unitOptions = units.map((u) => ({ value: u.id, label: `${u.short_name} — ${u.name}` }));

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit Purchase ${editing.invoice_no ? `(${editing.invoice_no})` : `#${editing.id}`}` : "Add Purchase"}
      subtitle={editing ? "Update the recorded purchase — stock and bill numbers adjust automatically" : "Record a multi-item supplier purchase"}
      wide
    >
      <DraftBanner draft={draft} />
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier">
            <SearchableSelect
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              options={[{ value: "", label: "Select supplier" }, ...suppliers.map((s) => ({ value: s.id, label: `${s.name}${s.company_name ? ` — ${s.company_name}` : ""}` }))]}
              placeholder="Select supplier"
              searchPlaceholder="Search suppliers..."
            />
          </Field>
          <Field label="Purchase date">
            <Input
              type="datetime-local"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </Field>
        </div>

        <Field label={editing ? "Bill number" : "Bill number (auto-generated)"}>
          <Input
            type="text"
            value={editing ? invoiceNo : ""}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder={editing ? "Leave blank to keep the current number" : "PUR-XXXX (assigned on save)"}
            disabled={!editing}
            className={editing ? "" : "!bg-slate-50 !text-slate-400"}
          />
        </Field>

        <Field label={`Bill images (optional, up to ${MAX_BILL_IMAGES})`}>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-600 transition hover:bg-slate-100 ${
                  billImages.length >= MAX_BILL_IMAGES ? "pointer-events-none opacity-50" : ""
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFiles}
                  className="hidden"
                />
                {billImages.length > 0 ? "Add more images" : "Upload bill images"}
              </label>
              {billImages.length > 0 && (
                <span className="text-xs font-medium text-slate-400">
                  {billImages.length} / {MAX_BILL_IMAGES}
                </span>
              )}
            </div>
            {billImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {billImages.map((img, idx) => (
                  <div key={idx} className="relative">
                    <img
                      src={img}
                      alt={`Bill ${idx + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      aria-label={`Remove image ${idx + 1}`}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Field>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Payment</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Status">
              <select
                value={payStatusVal}
                onChange={(e) => {
                  setPayStatusVal(e.target.value);
                  setPaidAmount(e.target.value === "paid" ? String(grandTotal) : "");
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="credit">Credit (not paid)</option>
                <option value="paid">Paid</option>
              </select>
            </Field>
            <Field label="Amount paid">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                disabled={payStatusVal === "paid"}
                placeholder="0.00"
              />
            </Field>
            <Field label="Reminder / due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <p className="text-sm font-semibold text-slate-700">Line Items</p>
            <Button type="button" variant="ghost" onClick={addItem} className="!px-2 !py-1 text-xs">
              <Plus className="h-3 w-3" /> Add item
            </Button>
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3">
            <BarcodeScanInput
              onScan={scanPurchaseProduct}
              placeholder="Scan a product barcode to add a purchase line…"
            />
          </div>
          {lineItems.map((it, idx) => {
            const totalQty = totalQtyOf(it);
            const profit = lineProfit(it);
            const margin = lineMargin(it);
            return (
              <div key={idx} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600 text-[11px] font-bold text-white">
                      {idx + 1}
                    </span>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Line item</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {Number(it.selling_price) > 0 && (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${profit >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
                        {profit >= 0 ? "+" : ""}{fmtMoney(profit)} · {margin.toFixed(1)}%
                      </span>
                    )}
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Product" required>
                      <SearchableSelect
                        value={it.product_id}
                        onChange={(e) => {
                          const pid = e.target.value;
                          const prod = allProducts.find((p) => String(p.id) === String(pid));
                          updateItem(idx, "product_id", pid);
                          if (prod) {
                            updateItem(idx, "item_name", prod.name);
                            updateItem(idx, "purchase_price", prod.purchase_price);
                            updateItem(idx, "selling_price", prod.selling_price ?? "");
                            updateItem(idx, "hsn_code", prod.hsn_code || "");
                            if (prod.unit_id) updateItem(idx, "unit_id", String(prod.unit_id));
                          }
                        }}
                        options={[{ value: "", label: "Select or type product" }, ...allProducts.map((p) => ({ value: String(p.id), label: p.name }))]}
                        loadOptions={loadProductOptions}
                        selectedLabel={it.item_name || ""}
                        placeholder="Select or type product"
                        searchPlaceholder="Search products..."
                      />
                    </Field>
                    <Field label="Item name">
                      <Input
                        value={it.item_name}
                        onChange={(e) => updateItem(idx, "item_name", e.target.value)}
                        placeholder="e.g. Basmati Rice"
                        required
                      />
                    </Field>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Unit">
                      <SearchableSelect
                        value={it.unit_id}
                        onChange={(e) => updateItem(idx, "unit_id", e.target.value)}
                        options={[{ value: "", label: "Select unit" }, ...unitOptions]}
                        placeholder="Select unit"
                        searchPlaceholder="Search..."
                      />
                    </Field>
                    <Field label="HSN code">
                      <Input
                        value={it.hsn_code}
                        onChange={(e) => updateItem(idx, "hsn_code", e.target.value)}
                        placeholder="e.g. 1006"
                      />
                    </Field>
                    <Field label="Sub-unit (kg, pkt...)">
                      <Input
                        value={it.pack_sub_unit}
                        onChange={(e) => updateItem(idx, "pack_sub_unit", e.target.value)}
                        placeholder="e.g. kg"
                      />
                    </Field>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Quantity & pricing
                    </p>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                      <Field label="Pack quantity">
                        <Input
                          type="number"
                          min="0.000001"
                          step="any"
                          value={it.quantity}
                          onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                          placeholder="e.g. 10"
                        />
                      </Field>
                      <Field label="Pack size">
                        <Input
                          type="number"
                          min="0.000001"
                          step="any"
                          value={it.pack_size}
                          onChange={(e) => updateItem(idx, "pack_size", e.target.value)}
                          placeholder="e.g. 30"
                        />
                      </Field>
                      <Field label="Purchase rate / sub-unit">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.purchase_price}
                          onChange={(e) => updateItem(idx, "purchase_price", e.target.value)}
                          placeholder="0.00"
                        />
                      </Field>
                      <Field label="Selling price / sub-unit">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.selling_price ?? ""}
                          onChange={(e) => updateItem(idx, "selling_price", e.target.value)}
                          placeholder="0.00"
                          className="!border-emerald-300 focus:!border-emerald-500"
                        />
                      </Field>
                      <Field label="Tax (%)">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.tax}
                          onChange={(e) => updateItem(idx, "tax", e.target.value)}
                          placeholder="0"
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Discount">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.discount}
                        onChange={(e) => updateItem(idx, "discount", e.target.value)}
                        placeholder="0.00"
                      />
                    </Field>
                  </div>

                  <div className="grid gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs sm:grid-cols-4 sm:items-center">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total qty</p>
                      <p className="font-semibold text-slate-700">
                        {fmtQty(totalQty)} {it.pack_sub_unit || "unit"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Purchase value</p>
                      <p className="font-semibold text-slate-800">{fmtMoney(lineTotal(it))}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Selling value</p>
                      <p className="font-semibold text-indigo-700">{fmtMoney(lineSellingValue(it))}</p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Est. profit</p>
                      <p className={`font-bold ${profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {profit >= 0 ? "+" : ""}{fmtMoney(profit)}
                        {Number(it.selling_price) > 0 && <span className="ml-1 font-medium text-slate-400">({margin.toFixed(1)}%)</span>}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Additional charges">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={additionalCharges}
              onChange={(e) => setAdditionalCharges(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <div className="flex flex-col justify-end">
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Items total</span>
                <span className="font-semibold text-slate-800">{fmtMoney(itemsTotal)}</span>
              </div>
              {charges > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Additional charges</span>
                  <span className="font-semibold text-slate-800">{fmtMoney(charges)}</span>
                </div>
              )}
              {sellingTotal > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Expected selling value</span>
                    <span className="font-semibold text-indigo-700">{fmtMoney(sellingTotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Est. profit</span>
                    <span className={`font-semibold ${expectedProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {expectedProfit >= 0 ? "+" : ""}{fmtMoney(expectedProfit)}
                      <span className="ml-1 font-medium text-slate-400">({expectedMargin.toFixed(1)}%)</span>
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <span className="text-sm font-semibold text-slate-700">Grand Total</span>
                <span className="text-xl font-bold text-indigo-700">{fmtMoney(grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save Changes" : "Record Purchase"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ViewPurchaseModal({ purchaseId, units, onClose, onUpdatePayment, onEdit }) {
  const [purchase, setPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeImage, setActiveImage] = useState(0);

  const unitMap = useMemo(() => {
    const m = {};
    units.forEach((u) => { m[u.id] = u; });
    return m;
  }, [units]);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.supplierPurchase(purchaseId);
        setPurchase(data);
      } catch {
        setPurchase(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [purchaseId]);

  if (loading) {
    return (
      <Modal open onClose={onClose} title="Purchase Details" wide>
        <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
      </Modal>
    );
  }

  if (!purchase) {
    return (
      <Modal open onClose={onClose} title="Purchase Details" wide>
        <div className="py-8 text-center text-sm text-slate-400">Purchase not found</div>
      </Modal>
    );
  }

  const items = purchase.items || [];
  const billImages =
    Array.isArray(purchase.bill_images) && purchase.bill_images.length > 0
      ? purchase.bill_images
      : purchase.bill_image
        ? [purchase.bill_image]
        : [];
  const itemsTotal = items.reduce((a, it) => {
    const packSize = Number(it.pack_size) || 1;
    const qty = Number(it.quantity) || 1;
    const totalQty = qty * packSize;
    const sub = (Number(it.purchase_price) || 0) * totalQty;
    const taxAmt = (sub * (Number(it.tax) || 0)) / 100;
    return a + sub + taxAmt - (Number(it.discount) || 0);
  }, 0);
  const sellingTotal = items.reduce((a, it) => {
    const totalQty = (Number(it.quantity) || 1) * (Number(it.pack_size) || 1);
    return a + (Number(it.selling_price) || 0) * totalQty;
  }, 0);
  const expectedProfit = items.reduce((a, it) => {
    const totalQty = (Number(it.quantity) || 1) * (Number(it.pack_size) || 1);
    return a + ((Number(it.selling_price) || 0) - (Number(it.purchase_price) || 0)) * totalQty;
  }, 0);
  const expectedMargin = sellingTotal > 0 ? (expectedProfit / sellingTotal) * 100 : 0;
  const charges = Number(purchase.additional_charges) || 0;
  const total = itemsTotal + charges;

  return (
    <Modal open onClose={onClose} title={`Purchase from ${purchase.supplier_name || "Unknown"}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Bill no</p>
            <p className="font-semibold text-indigo-700">{purchase.invoice_no || "—"}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Supplier</p>
            <p className="font-semibold text-slate-800">{purchase.supplier_name || "—"}</p>
            {purchase.supplier_company && (
              <p className="text-xs text-slate-500">{purchase.supplier_company}</p>
            )}
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Date</p>
            <p className="font-semibold text-slate-800">{fmtDateTime(purchase.purchased_at)}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Items</p>
            <p className="font-semibold text-slate-800">{items.length}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${payStatus(purchase).color}`}>
                {payStatus(purchase).label}
              </span>
              <span className="text-xs text-slate-400">
                Paid {fmtMoney(purchase.paid_amount || 0)} of {fmtMoney(purchase.grand_total)}
                {purchase.due_date ? ` · Reminder ${fmtDate(purchase.due_date)}` : ""}
              </span>
            </div>
            {payStatus(purchase).due > 0 && (
              <p className="mt-1 font-semibold text-amber-600">Balance {fmtMoney(payStatus(purchase).due)}</p>
            )}
          </div>
          <Button
            variant="ghost"
            onClick={() => onUpdatePayment && onUpdatePayment(purchase)}
            className="!px-3 !py-1.5 text-xs"
          >
            <Wallet className="h-3.5 w-3.5" /> Update payment / reminder
          </Button>
        </div>

        {billImages.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase text-slate-400">
              Bill {billImages.length === 1 ? "Image" : `Images (${billImages.length})`}
            </p>
            <img
              src={billImages[Math.min(activeImage, billImages.length - 1)]}
              alt={`Bill ${Math.min(activeImage, billImages.length - 1) + 1}`}
              decoding="async"
              className="max-h-48 rounded-xl border border-slate-200 object-contain"
            />
            {billImages.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {billImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveImage(idx)}
                    aria-label={`Show bill image ${idx + 1}`}
                    className={`overflow-hidden rounded-lg ring-2 transition ${
                      idx === Math.min(activeImage, billImages.length - 1)
                        ? "ring-indigo-500"
                        : "ring-transparent hover:ring-slate-300"
                    }`}
                  >
                    <img
                      src={img}
                      alt={`Bill ${idx + 1} thumbnail`}
                      loading="lazy"
                      decoding="async"
                      className="h-14 w-14 object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <Card className="!p-0">
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase text-slate-400">
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Unit</th>
                  <th className="px-4 py-2 text-right">Pack Size</th>
                  <th className="px-4 py-2 text-right">Packs</th>
                  <th className="px-4 py-2 text-right">Total Qty</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Sell</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                  <th className="px-4 py-2 text-right">Tax</th>
                  <th className="px-4 py-2 text-right">Disc</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const unit = it.unit_id ? unitMap[it.unit_id] : null;
                  const packSize = Number(it.pack_size) || 1;
                  const qty = Number(it.quantity) || 1;
                  const totalQty = qty * packSize;
                  const sub = (Number(it.purchase_price) || 0) * totalQty;
                  const taxAmt = (sub * (Number(it.tax) || 0)) / 100;
                  const lineT = sub + taxAmt - (Number(it.discount) || 0);
                  const sell = Number(it.selling_price) || 0;
                  const profit = (sell - (Number(it.purchase_price) || 0)) * totalQty;
                  const margin = sell > 0 ? ((sell - (Number(it.purchase_price) || 0)) / sell) * 100 : 0;
                  return (
                    <tr key={it.id} className="border-b border-slate-50">
                      <td className="px-4 py-2">
                        <p className="font-medium text-slate-800">{it.product_name || it.item_name}</p>
                        {it.hsn_code && <p className="text-[11px] text-slate-400">HSN: {it.hsn_code}</p>}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{it.pack_sub_unit || (unit ? unit.short_name : "—")}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{fmtQty(packSize)} {it.pack_sub_unit || ""}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{fmtQty(qty)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-800">{fmtQty(totalQty)} {it.pack_sub_unit || ""}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{fmtMoney(it.purchase_price)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-indigo-700">{sell > 0 ? fmtMoney(sell) : "—"}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {sell > 0 ? `${profit >= 0 ? "+" : ""}${fmtMoney(profit)} (${margin.toFixed(1)}%)` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600">{it.tax ? `${it.tax}%` : "—"}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{it.discount ? fmtMoney(it.discount) : "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-800">{fmtMoney(lineT)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 p-4 sm:hidden">
            {items.map((it) => {
              const unit = it.unit_id ? unitMap[it.unit_id] : null;
              const packSize = Number(it.pack_size) || 1;
              const qty = Number(it.quantity) || 1;
              const totalQty = qty * packSize;
              const sub = (Number(it.purchase_price) || 0) * totalQty;
              const taxAmt = (sub * (Number(it.tax) || 0)) / 100;
              const lineT = sub + taxAmt - (Number(it.discount) || 0);
              const sell = Number(it.selling_price) || 0;
              const profit = (sell - (Number(it.purchase_price) || 0)) * totalQty;
              const margin = sell > 0 ? ((sell - (Number(it.purchase_price) || 0)) / sell) * 100 : 0;
              return (
                <div key={it.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-slate-800">{it.product_name || it.item_name}</p>
                      {it.hsn_code && <p className="text-[11px] text-slate-400">HSN: {it.hsn_code}</p>}
                    </div>
                    <p className="font-bold text-slate-800">{fmtMoney(lineT)}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
                    <span>Unit: {it.pack_sub_unit || (unit ? unit.short_name : "—")}</span>
                    <span>Packs: {fmtQty(qty)}</span>
                    <span>Size: {fmtQty(packSize)}</span>
                    <span>Total: {fmtQty(totalQty)}</span>
                    <span>Rate: {fmtMoney(it.purchase_price)}</span>
                    <span>Sell: {sell > 0 ? fmtMoney(sell) : "—"}</span>
                    {it.tax ? <span>Tax: {it.tax}%</span> : null}
                    {sell > 0 ? (
                      <span className={profit >= 0 ? "text-emerald-600" : "text-rose-600"}>
                        Profit: {profit >= 0 ? "+" : ""}{fmtMoney(profit)} ({margin.toFixed(1)}%)
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Items total</span>
            <span className="font-semibold text-slate-800">{fmtMoney(itemsTotal)}</span>
          </div>
          {charges > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Additional charges</span>
              <span className="font-semibold text-slate-800">{fmtMoney(charges)}</span>
            </div>
          )}
          {sellingTotal > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-slate-500">Expected selling value</span>
                <span className="font-semibold text-indigo-700">{fmtMoney(sellingTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Est. profit</span>
                <span className={`font-semibold ${expectedProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {expectedProfit >= 0 ? "+" : ""}{fmtMoney(expectedProfit)}
                  <span className="ml-1 font-medium text-slate-400">({expectedMargin.toFixed(1)}%)</span>
                </span>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2">
            <span className="font-semibold text-slate-700">Grand Total</span>
            <span className="text-xl font-bold text-indigo-700">{fmtMoney(total)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {onEdit && (
            <Button variant="soft" onClick={() => onEdit(purchase)}>
              <Pencil className="h-3.5 w-3.5" /> Edit purchase
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({ purchase, onClose, onSaved }) {
  const total = Number(purchase.grand_total) || 0;
  const [amount, setAmount] = useState(String(purchase.paid_amount || ""));
  const [due, setDue] = useState(dateOnly(purchase.due_date));
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const draft = useFormDraft({
    key: `purchase-payment:${purchase.id}`,
    value: { amount, due },
    apply: (v) => {
      if (v.amount !== undefined) setAmount(v.amount);
      if (v.due !== undefined) setDue(v.due);
    }
  });

  const balance = Math.max(0, total - (Number(amount) || 0));

  const submit = async () => {
    setSaving(true);
    try {
      await api.updateSupplierPayment(purchase.id, {
        paid_amount: Number(amount) || 0,
        due_date: due || null
      });
      await draft.clear();
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Payment & reminder"
      subtitle={purchase.supplier_name || "Purchase"}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save payment"}
          </Button>
        </>
      }
    >
      <DraftBanner draft={draft} />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] text-slate-400">Grand total</p>
            <p className="font-bold text-slate-800">{fmtMoney(total)}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="text-[11px] text-amber-500">Balance after this</p>
            <p className="font-bold text-amber-700">{fmtMoney(balance)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="soft" className="flex-1 !px-2 text-xs" onClick={() => setAmount(String(total))}>
            <Check className="h-3.5 w-3.5" /> Full paid
          </Button>
          <Button type="button" variant="ghost" className="flex-1 !px-2 text-xs" onClick={() => setAmount("0")}>
            No payment
          </Button>
        </div>
        <Field label="Amount paid">
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Payment reminder / due date">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        {err && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
      </div>
    </Modal>
  );
}