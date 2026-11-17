import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { Plus, Search, ShoppingCart, Eye, Pencil, Trash2, CreditCard, X, Printer, Minus, FileSpreadsheet, FileText, MessageCircle, Ticket, BadgeCheck, RotateCcw, ChevronDown, Award, Coins, Gift } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import DraftBanner from "../components/DraftBanner.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import BarcodeScanInput from "../components/BarcodeScanInput.jsx";
import Pagination from "../components/Pagination.jsx";
import PrintMenu from "../components/PrintMenu.jsx";
import SalesCommandStrip from "../components/SalesCommandStrip.jsx";
import { fmtMoney, fmtDateTime, fmtQty } from "../lib/format.js";
import { printInvoiceA4 } from "../lib/receipt.js";
import { printReceiptOnLaptop, printSalesCommandLabelOnLaptop } from "../lib/printRemote.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { matchGlobalScanCommand, matchSalesCommand, printSalesCommandCard } from "../lib/salesCommands.js";
import useScannerCapture from "../lib/useScannerCapture.js";
import { buildSaleWhatsAppText, sendWhatsApp } from "../lib/whatsapp.js";
import { useFormDraft, useDraftReopen } from "../lib/formDraft.js";

const PAGE_SIZE = 20;

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "credit", label: "Credit" },
  { value: "online", label: "UPI / Online" }
];

const PAY_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "UPI / Online" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" }
];

const todayLocalISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const STATUS_COLORS = {
  paid: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  credit: "bg-rose-50 text-rose-700",
  booking: "bg-violet-50 text-violet-700"
};

const fmtRate = (value) =>
  `Rs ${(Number(value) || 0).toLocaleString("en-IN", { maximumFractionDigits: 4 })}`;

const pointsValueFor = (lots, points) => {
  let left = Math.max(0, Math.trunc(Number(points) || 0));
  let discount = 0;
  const used = [];
  for (const lot of lots || []) {
    if (left <= 0) break;
    const value = Number(lot.point_value) || 0;
    const available = Number(lot.points) || 0;
    if (value <= 0) {
      const take = Math.min(left, available);
      if (take > 0) {
        used.push({ ...lot, take, discount: 0 });
        left -= take;
      }
      continue;
    }
    const take = Math.min(left, available);
    if (take <= 0) continue;
    const amount = Math.round(take * value * 100) / 100;
    used.push({ ...lot, take, discount: amount });
    discount += amount;
    left -= take;
  }
  return {
    points: Math.max(0, Math.trunc(Number(points) || 0) - left),
    discount: Math.round(discount * 100) / 100,
    used
  };
};

const maxRedeemablePoints = (lots, maxDiscount) => {
  let left = Math.max(0, Number(maxDiscount) || 0);
  let points = 0;
  for (const lot of lots || []) {
    const value = Number(lot.point_value) || 0;
    const available = Number(lot.points) || 0;
    if (value <= 0) {
      points += available;
      continue;
    }
    const affordable = Math.floor((left + 1e-9) / value);
    const take = Math.min(available, affordable);
    points += take;
    left -= take * value;
    if (take < available) break;
  }
  return points;
};

export default function Sales({ action, onActionConsumed }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ count: 0, total: 0, paid: 0, outstanding: 0, profit: 0 });
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState(todayLocalISO);
  const [dateTo, setDateTo] = useState(todayLocalISO);
  const [open, setOpen] = useState(false);
  const [editingSale, setEditingSale] = useState(null);
  const [viewSale, setViewSale] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [payMethod, setPayMethod] = useState("cash");
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const [printFor, setPrintFor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [loadingExpand, setLoadingExpand] = useState(false);
  const expandToken = useRef(null);
  const printAnchors = useRef({});
  const [lastSaleId, setLastSaleId] = useState(null);
  const [lastSaleLabel, setLastSaleLabel] = useState("");
  const [focusCustomerAt, setFocusCustomerAt] = useState(0);

  const doPrint = async (id, layout) => {
    try {
      const detail = await api.sale(id);
      setLastSaleId(detail.id ?? id);
      setLastSaleLabel(detail.invoice_no || "");
      const info = getStoreInfo();
      if (layout === "a4") {
        printInvoiceA4(detail, detail.items || [], info);
      } else {
        setToast("Sending receipt to the printer…");
        await printReceiptOnLaptop(detail, detail.items || [], info);
        setToast("Receipt sent to the printer");
      }
    } catch (e) {
      setToast(layout === "a4" ? "Failed to load sale details for printing" : e.message || "Failed to print receipt");
    }
  };

  const printLastSale = async () => {
    if (!lastSaleId) {
      setToast("No bill selected. Create or view a bill first.");
      return;
    }
    await doPrint(lastSaleId, "thermal");
  };

  const printCommandLabel = async (command) => {
    try {
      setToast(`Sending ${command.label} barcode to the printer…`);
      await printSalesCommandLabelOnLaptop(getStoreInfo(), command);
      setToast(`${command.label} barcode sent to the printer`);
    } catch (e) {
      setToast(e.message || "Failed to print command barcode");
    }
  };

  useScannerCapture({
    enabled: !open && !editingSale && !payFor && !toDelete,
    onScan: (code) => {
      const command = matchSalesCommand(code);
      if (!command) {
        if (/^(CT|BT)/i.test(String(code || "").trim())) {
          setToast("Open a new bill to scan customers or products.");
        }
        return;
      }
      if (command.id === "print") {
        printLastSale();
        return;
      }
      setToast("Open a new bill first to use Create Bill or Paid.");
    }
  });

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
      setFocusCustomerAt(action.nonce || Date.now());
      onActionConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.nonce]);

  // Lazily loads a sale's line items the first time a row is opened, then keeps
  // them cached. The token guard stops a slow response for a row the user has
  // since collapsed (or replaced by another row) from overwriting the state.
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
      const data = await api.sale(id);
      if (expandToken.current === token) setExpandedData({ id, items: data.items || [] });
    } catch {
      if (expandToken.current === token) setExpandedData({ id, items: [] });
    } finally {
      if (expandToken.current === token) setLoadingExpand(false);
    }
  };

  const salesQS = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
    if (statusFilter) p.set("status", statusFilter);
    p.set("page", String(page));
    p.set("limit", String(PAGE_SIZE));
    return p.toString();
  }, [dateFrom, dateTo, debouncedSearch, statusFilter, page]);

  const exportQS = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
    if (statusFilter) p.set("status", statusFilter);
    p.set("page", "1");
    p.set("limit", "500");
    return p.toString();
  }, [dateFrom, dateTo, debouncedSearch, statusFilter]);

  const loadSales = async () => {
    setLoading(true);
    // Drop any cached line items so a reload never shows stale stock/prices.
    setExpanded(null);
    setExpandedData(null);
    try {
      const s = await api.sales(salesQS);
      setRows(s.rows || []);
      setTotal(Number(s.total) || 0);
      setSummary(s.summary || { count: 0, total: 0, paid: 0, outstanding: 0, profit: 0 });
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // The full product and customer catalogues are no longer downloaded on
  // mount. Picking a bill line now searches the server, so opening Sales with
  // a large catalogue stays fast. Units are small enough to keep loading whole.
  const loadUnits = async () => {
    try {
      const u = await api.measuringUnits();
      setUnits(u);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    loadUnits();
  }, []);

  const mergeProducts = useCallback((incoming) => {
    const list = (Array.isArray(incoming) ? incoming : [incoming]).filter(Boolean);
    if (list.length === 0) return;
    setProducts((prev) => {
      const map = new Map(prev.map((p) => [String(p.id), p]));
      for (const row of list) map.set(String(row.id), { ...(map.get(String(row.id)) || {}), ...row });
      return [...map.values()];
    });
  }, []);

  const mergeCustomers = useCallback((incoming) => {
    const list = (Array.isArray(incoming) ? incoming : [incoming]).filter(Boolean);
    if (list.length === 0) return;
    setCustomers((prev) => {
      const map = new Map(prev.map((c) => [String(c.id), c]));
      for (const row of list) map.set(String(row.id), { ...(map.get(String(row.id)) || {}), ...row });
      return [...map.values()];
    });
  }, []);

  useEffect(() => {
    loadSales();
  }, [salesQS]);

  useDraftReopen({
    prefix: "sales",
    open: open || !!editingSale,
    session: editingSale?.id ?? null,
    onReopen: (id) => {
      if (id) openEditSale({ id });
      else setOpen(true);
    }
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows;

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const stats = summary;

  const openCreate = () => setOpen(true);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const result = await api.sales(exportQS);
      const data = (result.rows || []).map((s) => ({
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
      const { utils, writeFile } = await import("xlsx");
      const ws = utils.json_to_sheet(data);
      ws["!cols"] = [
        { wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 14 },
        { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }
      ];
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, "Sales");
      writeFile(wb, `sales_${new Date().toISOString().slice(0, 10)}.xlsx`);
      setToast(
        Number(result.total) > data.length
          ? `Exported first ${data.length} of ${result.total} matching sales`
          : `Exported ${data.length} sale(s) to Excel`
      );
    } catch (e) {
      setToast(e.message || "Could not export sales");
    } finally {
      setExporting(false);
    }
  };

  // After a write only the one changed bill and the cheap day-summary are
  // fetched. The old code reloaded the whole sales page plus the full product
  // and customer catalogues on every save, which is what made saving crawl on
  // a busy shop.
  const refreshSummary = async () => {
    const p = new URLSearchParams(salesQS);
    p.set("page", "1");
    p.set("limit", "1");
    const res = await api.sales(p.toString());
    setSummary(res.summary || { count: 0, total: 0, paid: 0, outstanding: 0, profit: 0 });
    setTotal(Number(res.total) || 0);
  };

  const rowFromDetail = (detail) => {
    const items = Array.isArray(detail?.items) ? detail.items : [];
    const hsn = [...new Set(items.map((it) => it.hsn_code).filter(Boolean))];
    const taxes = [...new Set(items.map((it) => Number(it.tax) || 0).filter((t) => t > 0))];
    return {
      ...detail,
      customer: detail.customer || "Walk-in",
      item_count: items.length,
      profit: Number(detail.total_profit) || 0,
      hsn_codes: hsn.join(", "),
      tax_rates: taxes.map(String).join(", "),
      tax_amt: items.reduce((sum, it) => sum + (Number(it.tax_amt) || 0), 0)
    };
  };

  const upsertRow = (row) => {
    if (!row) return;
    setRows((prev) => {
      const idx = prev.findIndex((r) => String(r.id) === String(row.id));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...prev[idx], ...row };
        return next;
      }
      const day = String(row.created_at || "").slice(0, 10);
      const inRange = (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
      const matchesStatus = !statusFilter || row.status === statusFilter;
      const needle = debouncedSearch.trim().toLowerCase();
      const hay = `${row.invoice_no || ""} ${row.customer || ""} ${row.customer_phone || ""}`.toLowerCase();
      const matchesSearch = !needle || hay.includes(needle);
      if (page !== 1 || !inRange || !matchesStatus || !matchesSearch) return prev;
      return [row, ...prev].slice(0, PAGE_SIZE);
    });
  };

  const handleCreate = async (saleData) => {
    setSaving(true);
    try {
      const res = await api.createSale(saleData);
      setLastSaleId(res.id);
      setLastSaleLabel(res.invoice_no || "");
      setOpen(false);
      const notes = [];
      if (res.voucher?.code) {
        const amt = res.voucher.discount_type === "percent" ? `${res.voucher.discount_value}%` : `Rs ${res.voucher.discount_value}`;
        notes.push(`Voucher ${res.voucher.code} (${amt}) printed on bill — ${res.voucher.campaign_name}`);
      }
      if (res.redeemed) {
        notes.push(`Voucher ${res.redeemed.code} used, ${fmtMoney(res.redeemed.discount)} off · ${res.redeemed.remaining_uses} use${res.redeemed.remaining_uses === 1 ? "" : "s"} left`);
      }
      if (Number(res.points_earned) > 0) {
        notes.push(`${res.points_earned} point${Number(res.points_earned) === 1 ? "" : "s"} earned`);
      }
      setToast(notes.length ? `Sale created · ${notes.join(" · ")}` : "Sale created");
      const [detail] = await Promise.all([api.sale(res.id), refreshSummary()]);
      upsertRow(rowFromDetail(detail));
    } catch (err) {
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const openEditSale = async (s) => {
    try {
      const detail = await api.sale(s.id);
      const productIds = [...new Set((detail.items || []).map((it) => it.product_id).filter(Boolean))];
      const known = new Set(products.map((p) => String(p.id)));
      const missing = productIds.filter((id) => !known.has(String(id)));
      if (missing.length) {
        const loaded = await Promise.all(missing.map((id) => api.product(id).catch(() => null)));
        mergeProducts(loaded.filter(Boolean));
      }
      if (detail.customer_id && !customers.some((c) => String(c.id) === String(detail.customer_id))) {
        const customer = await api.customer(detail.customer_id).catch(() => null);
        if (customer) mergeCustomers(customer);
      }
      setLastSaleId(detail.id ?? s.id);
      setLastSaleLabel(detail.invoice_no || s.invoice_no || "");
      setEditingSale(detail);
    } catch (err) {
      setToast(err.message || "Failed to load bill");
    }
  };

  const openViewSale = (s) => {
    setLastSaleId(s.id);
    setLastSaleLabel(s.invoice_no || "");
    setViewSale(s);
  };

  const handleUpdate = async (saleId, saleData) => {
    setSaving(true);
    try {
      const res = await api.updateSale(saleId, saleData);
      setEditingSale(null);
      setToast(res.items_locked ? "Bill updated · items kept because returns exist" : "Bill updated");
      const [detail] = await Promise.all([api.sale(saleId), refreshSummary()]);
      upsertRow(rowFromDetail(detail));
    } catch (err) {
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const dueOf = (s) =>
    Math.max(0, Math.round(((Number(s.total) || 0) - (Number(s.paid) || 0)) * 100) / 100);

  const canMarkPaid = (s) =>
    dueOf(s) > 0 &&
    s.status !== "cancelled" &&
    !(s.channel === "online" && s.status === "booking");

  const openMarkPaid = (s) => {
    if (!canMarkPaid(s)) {
      setToast(
        s.channel === "online" && s.status === "booking"
          ? "Confirm this online order first"
          : "This bill is already fully paid"
      );
      return;
    }
    setPayFor(s);
    setPayMethod("cash");
    setPayError(null);
  };

  const confirmMarkPaid = async () => {
    if (!payFor) return;
    const due = dueOf(payFor);
    if (!(due > 0)) {
      setPayError("This bill is already fully paid");
      return;
    }
    setPaySaving(true);
    setPayError(null);
    try {
      await api.createCustomerPayment({
        sale_id: payFor.id,
        amount: due,
        method: payMethod,
        paid_on: todayLocalISO()
      });
      setLastSaleId(payFor.id);
      setLastSaleLabel(payFor.invoice_no || "");
      setPayFor(null);
      setViewSale(null);
      setToast("Bill marked paid");
      setRows((prev) =>
        prev.map((r) =>
          String(r.id) === String(payFor.id)
            ? { ...r, paid: Number(r.total) || 0, status: "paid" }
            : r
        )
      );
      await refreshSummary();
    } catch (e) {
      setPayError(e.message);
    } finally {
      setPaySaving(false);
    }
  };

  const handleCustomerCreated = (customer) => {
    mergeCustomers(customer);
    if (customer?.barcode) setToast(`Customer added · Card ${customer.barcode}`);
  };

  const confirmDelete = async () => {
    try {
      await api.deleteSale(toDelete.id);
      if (lastSaleId === toDelete.id) {
        setLastSaleId(null);
        setLastSaleLabel("");
      }
      setToDelete(null);
      setToast("Sale deleted");
      setRows((prev) => prev.filter((r) => String(r.id) !== String(toDelete.id)));
      await refreshSummary();
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

      <SalesCommandStrip
        lastSaleLabel={lastSaleLabel}
        onPrintCard={() => printSalesCommandCard(getStoreInfo())}
        onPrintCommand={printCommandLabel}
      />

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
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="soft" onClick={exportExcel} disabled={total === 0 || exporting}>
            <FileSpreadsheet className="h-4 w-4" /> {exporting ? "Exporting…" : "Export Excel"}
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
        ) : total === 0 ? (
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
              <table className="w-full border-separate border-spacing-y-2 text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 [&>th]:border-b [&>th]:border-slate-100">
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
                  {pageRows.map((s) => {
                    const isOpen = expanded === s.id;
                    const items = expandedData?.id === s.id ? expandedData.items : [];
                    return (
                      <Fragment key={s.id}>
                        <tr
                          className={`transition [&>td]:border-y [&>td]:border-l [&>td]:border-r [&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl ${
                            isOpen
                              ? "[&>td]:border-indigo-200 bg-indigo-50/40"
                              : "[&>td]:border-slate-200/80 bg-white hover:bg-slate-50/60"
                          }`}
                        >
                          <td className="px-3 py-3 sm:px-5">
                            <button
                              type="button"
                              onClick={() => toggleExpand(s.id)}
                              aria-expanded={isOpen}
                              className="group flex items-center gap-2 text-left"
                            >
                              <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all duration-300 ${
                                  isOpen
                                    ? "bg-indigo-600 text-white"
                                    : "bg-slate-100 text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600"
                                }`}
                              >
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
                              </span>
                              <span className="min-w-0">
                                <span className="block font-mono font-semibold text-indigo-600">{s.invoice_no}</span>
                                <span className="block text-[11px] text-slate-400">
                                  {s.item_count || 0} {Number(s.item_count) === 1 ? "item" : "items"}
                                </span>
                              </span>
                            </button>
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
                              {canMarkPaid(s) && (
                                <button
                                  onClick={() => openMarkPaid(s)}
                                  className="rounded-lg p-1.5 text-emerald-600 transition hover:bg-emerald-50 hover:text-emerald-700"
                                  aria-label="Mark paid"
                                  title={`Mark paid · due ${fmtMoney(dueOf(s))}`}
                                >
                                  <CreditCard className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                ref={(el) => { if (el) printAnchors.current[`d${s.id}`] = el; else delete printAnchors.current[`d${s.id}`]; }}
                                onClick={() => setPrintFor((p) => (p === s.id ? null : s.id))}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                                aria-label="Print"
                              >
                                <Printer className="h-4 w-4" />
                              </button>
                              <PrintMenu
                                open={printFor === s.id}
                                anchorEl={printFor === s.id ? printAnchors.current[`d${s.id}`] : null}
                                onClose={() => setPrintFor(null)}
                                onThermal={() => { setPrintFor(null); doPrint(s.id, "thermal"); }}
                                onA4={() => { setPrintFor(null); doPrint(s.id, "a4"); }}
                              />
                              <button
                                onClick={() => openViewSale(s)}
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
                                onClick={() => openEditSale(s)}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                                aria-label="Edit"
                                title="Edit bill"
                              >
                                <Pencil className="h-4 w-4" />
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
                        {isOpen && (
                          <tr className="bg-indigo-50/30 [&>td]:rounded-xl [&>td]:border [&>td]:border-indigo-100">
                            <td colSpan={8} className="px-3 pb-4 pt-1 sm:px-5">
                              <SaleItemsPanel items={items} sale={s} loading={loadingExpand} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2.5 sm:hidden">
              {pageRows.map((s) => {
                const isOpen = expanded === s.id;
                const items = expandedData?.id === s.id ? expandedData.items : [];
                return (
                  <div
                    key={s.id}
                    className={`rounded-xl border px-4 py-3.5 transition-colors duration-200 ${
                      isOpen ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200/80 bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(s.id)}
                      aria-expanded={isOpen}
                      className="flex w-full items-start justify-between gap-2 text-left"
                    >
                      <span className="flex min-w-0 items-start gap-2">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all duration-300 ${
                            isOpen ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-mono font-semibold text-indigo-600">{s.invoice_no}</span>
                          <span className="mt-0.5 block truncate text-sm text-slate-800">{s.customer || "Walk-in"}</span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {fmtDateTime(s.created_at)} · <span className="capitalize">{s.payment_method}</span> ·{" "}
                            {s.item_count || 0} {Number(s.item_count) === 1 ? "item" : "items"}
                          </span>
                        </span>
                      </span>
                      <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[s.status] || "bg-slate-100 text-slate-600"}`}>
                        {s.status}
                      </span>
                    </button>
                    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-bold text-slate-800">{fmtMoney(s.total)}</span>
                        <span className="text-[11px] text-slate-400">paid {fmtMoney(s.paid)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {canMarkPaid(s) && (
                          <button
                            onClick={() => openMarkPaid(s)}
                            className="rounded-lg p-1.5 text-emerald-600 transition hover:bg-emerald-50 hover:text-emerald-700"
                            aria-label="Mark paid"
                            title={`Mark paid · due ${fmtMoney(dueOf(s))}`}
                          >
                            <CreditCard className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          ref={(el) => { if (el) printAnchors.current[`m${s.id}`] = el; else delete printAnchors.current[`m${s.id}`]; }}
                          onClick={() => setPrintFor((p) => (p === s.id ? null : s.id))}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                          aria-label="Print"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <PrintMenu
                          open={printFor === s.id}
                          anchorEl={printFor === s.id ? printAnchors.current[`m${s.id}`] : null}
                          onClose={() => setPrintFor(null)}
                          onThermal={() => { setPrintFor(null); doPrint(s.id, "thermal"); }}
                          onA4={() => { setPrintFor(null); doPrint(s.id, "a4"); }}
                        />
                        <button
                          onClick={() => openViewSale(s)}
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
                          onClick={() => openEditSale(s)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                          aria-label="Edit"
                          title="Edit bill"
                        >
                          <Pencil className="h-4 w-4" />
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
                    {isOpen && (
                      <div className="mt-3">
                        <SaleItemsPanel items={items} sale={s} loading={loadingExpand} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!loading && !error && total > 0 && (
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        )}
      </Card>

      {open && (
        <NewSaleModal
          products={products}
          customers={customers}
          units={units}
          onProductsLoaded={mergeProducts}
          onCustomersLoaded={mergeCustomers}
          onSave={handleCreate}
          onClose={() => setOpen(false)}
          onCustomerCreated={handleCustomerCreated}
          onPrintLast={printLastSale}
          saving={saving}
          focusCustomerAt={focusCustomerAt}
        />
      )}

      {editingSale && (
        <NewSaleModal
          key={editingSale.id}
          sale={editingSale}
          products={products}
          customers={customers}
          units={units}
          onProductsLoaded={mergeProducts}
          onCustomersLoaded={mergeCustomers}
          onSave={(data) => handleUpdate(editingSale.id, data)}
          onClose={() => setEditingSale(null)}
          onCustomerCreated={handleCustomerCreated}
          onPrintLast={printLastSale}
          saving={saving}
        />
      )}

      {viewSale && (
        <ViewSaleModal
          sale={viewSale}
          onClose={() => setViewSale(null)}
          onMarkPaid={openMarkPaid}
        />
      )}

      {payFor && (
        <MarkPaidModal
          sale={payFor}
          method={payMethod}
          onMethodChange={setPayMethod}
          saving={paySaving}
          error={payError}
          onConfirm={confirmMarkPaid}
          onClose={() => {
            if (paySaving) return;
            setPayFor(null);
            setPayError(null);
          }}
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

function RedeemPointsModal({ open, onClose, info, loading, error, maxDiscount, initialPoints, onApply }) {
  const [value, setValue] = useState("");
  const lots = info?.lots || [];
  const balance = Number(info?.points) || 0;
  const maxPoints = Math.min(balance, maxRedeemablePoints(lots, maxDiscount));

  useEffect(() => {
    if (!open) return;
    setValue(initialPoints > 0 ? String(initialPoints) : "");
  }, [open, initialPoints]);

  const enteredRaw = Math.trunc(Number(value) || 0);
  const entered = Math.max(0, Math.min(enteredRaw, maxPoints));
  const calc = pointsValueFor(lots, entered);
  const newTotal = Math.max(0, Math.round((maxDiscount - calc.discount) * 100) / 100);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Redeem loyalty points"
      subtitle={info?.name ? `Available to ${info.name}` : "Use points to reduce this bill"}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => entered > 0 && onApply(entered)} disabled={loading || entered <= 0}>
            {entered > 0 ? `Apply ${entered.toLocaleString("en-US")} points` : "Apply points"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-11 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-amber-50 px-3 py-2">
              <p className="text-[10px] font-medium uppercase text-amber-600">Available balance</p>
              <p className="mt-0.5 text-lg font-bold text-amber-900">
                {balance.toLocaleString("en-US")} pts
              </p>
            </div>
            <div className="rounded-xl bg-indigo-50 px-3 py-2">
              <p className="text-[10px] font-medium uppercase text-indigo-600">Max usable here</p>
              <p className="mt-0.5 text-lg font-bold text-indigo-900">
                {maxPoints.toLocaleString("en-US")} pts
              </p>
            </div>
          </div>

          <Field
            label="Points to redeem"
            hint={
              maxPoints > 0
                ? `Up to ${maxPoints.toLocaleString("en-US")} points on this bill.`
                : "This bill is already fully covered, or the balance has no redeemable value."
            }
          >
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                max={maxPoints}
                step="1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                disabled={maxPoints <= 0}
              />
              <Button
                type="button"
                variant="soft"
                onClick={() => setValue(String(maxPoints))}
                disabled={maxPoints <= 0}
              >
                Use max
              </Button>
            </div>
          </Field>

          {enteredRaw > maxPoints && maxPoints > 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Only {maxPoints.toLocaleString("en-US")} points can be used on this bill.
            </p>
          )}

          {calc.used.length > 0 && (
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase text-slate-400">Value breakdown</p>
              <div className="mt-1.5 space-y-1">
                {calc.used.map((lot, index) => (
                  <div key={index} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-600">
                      {lot.take.toLocaleString("en-US")} pts × {fmtRate(lot.point_value)}
                      {lot.legacy ? (
                        <span className="ml-1 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-500">
                          legacy
                        </span>
                      ) : null}
                    </span>
                    <span className="font-semibold text-slate-800">{fmtMoney(lot.discount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <div className="flex items-center justify-between">
              <span>Points discount</span>
              <span className="font-semibold">−{fmtMoney(calc.discount)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-emerald-200/70 pt-1 font-bold">
              <span>New bill total</span>
              <span>{fmtMoney(newTotal)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-emerald-700">
              <span>Points after redemption</span>
              <span>{Math.max(0, balance - entered).toLocaleString("en-US")} pts</span>
            </div>
          </div>

          {maxPoints <= 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Add items or select a customer with points to redeem.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function NewSaleModal({ sale, products, customers, units, onProductsLoaded, onCustomersLoaded, onSave, onClose, onCustomerCreated, onPrintLast, saving, focusCustomerAt = 0 }) {
  const isEdit = !!sale;
  const itemsLocked = isEdit && (sale.has_returns || Number(sale.returned_total) > 0);
  const [customerId, setCustomerId] = useState(sale?.customer_id ? String(sale.customer_id) : "");
  const [paymentMethod, setPaymentMethod] = useState(sale?.payment_method || "cash");
  const [status, setStatus] = useState(sale?.status || "credit");
  const [note, setNote] = useState(sale?.note || "");
  const [items, setItems] = useState(() =>
    [...(sale?.items || [])].reverse().map((it) => ({
      product_id: String(it.product_id),
      qty: String(it.qty ?? 1),
      sale_unit_id: it.unit_id ? String(it.unit_id) : "",
      unit_price: Number(it.unit_price) || 0,
      market_price: Number(it.market_price) || 0
    }))
  );
  const [quickAdd, setQuickAdd] = useState("");
  const [error, setError] = useState(null);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherApp, setVoucherApp] = useState(() => {
    const uv = sale?.used_voucher;
    if (!uv) return null;
    return {
      code: uv.code,
      campaign_name: uv.campaign_name,
      discount_type: uv.discount_type,
      discount_value: Number(uv.discount_value) || 0,
      min_total: Number(uv.min_total) || 0,
      months: 0,
      remaining_uses: 0,
      used_this_month: false,
      valid_through: null
    };
  });
  const [voucherErr, setVoucherErr] = useState(null);
  const [checking, setChecking] = useState(false);
  const [amountEdits, setAmountEdits] = useState({});
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerErr, setCustomerErr] = useState(null);
  const [customerScanErr, setCustomerScanErr] = useState(null);
  const [scannedCustomers, setScannedCustomers] = useState([]);
  const submittingRef = useRef(false);
  const customerScanRef = useRef(null);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [pointsInfo, setPointsInfo] = useState(null);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsErr, setPointsErr] = useState(null);
  const [redeemPoints, setRedeemPoints] = useState(0);

  const draft = useFormDraft({
    key: isEdit ? `sales:edit:${sale.id}` : "sales:new",
    value: { customerId, paymentMethod, status, note, items, voucherCode, voucherApp },
    apply: (v) => {
      if (v.customerId !== undefined) setCustomerId(v.customerId);
      if (v.paymentMethod !== undefined) setPaymentMethod(v.paymentMethod);
      if (v.status !== undefined) setStatus(v.status);
      if (v.note !== undefined) setNote(v.note);
      if (Array.isArray(v.items)) {
        setItems(v.items);
        setAmountEdits({});
      }
      if (v.voucherCode !== undefined) setVoucherCode(v.voucherCode);
      if (v.voucherApp !== undefined) setVoucherApp(v.voucherApp);
    },
    autoRestore: isEdit
  });

  useEffect(() => {
    if (isEdit) return undefined;
    const timer = setTimeout(() => customerScanRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [isEdit, focusCustomerAt]);

  const unitMap = useMemo(() => {
    const m = {};
    units.forEach((u) => { m[u.id] = u; });
    return m;
  }, [units]);

  const getProduct = (id) => products.find((p) => String(p.id) === String(id));

  const clearAmountEdit = (idx) =>
    setAmountEdits((prev) => {
      if (!(idx in prev)) return prev;
      const next = { ...prev };
      delete next[idx];
      return next;
    });

  const updateItem = (idx, field, val) => {
    setItems((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const setQty = (idx, val) => {
    clearAmountEdit(idx);
    updateItem(idx, "qty", val);
  };

  const setRate = (idx, val) => {
    clearAmountEdit(idx);
    updateItem(idx, "price_override", val);
  };

  const setAmount = (idx, val) => {
    setAmountEdits((prev) => ({ ...prev, [idx]: val }));
    const it = items[idx];
    const qty = Number(it?.qty) || 0;
    const amount = Number(val);
    if (!it || val === "" || !Number.isFinite(amount) || qty <= 0) return;
    updateItem(idx, "price_override", String(Math.round((amount / qty) * 100) / 100));
  };

  const resetRate = (idx) => {
    clearAmountEdit(idx);
    updateItem(idx, "price_override", undefined);
  };

  const removeItem = (idx) => {
    setAmountEdits({});
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const bumpQty = (idx, delta) => {
    const it = items[idx];
    if (!it) return;
    const next = Math.max(0.000001, Math.round(((Number(it.qty) || 1) + delta) * 1000000) / 1000000);
    setQty(idx, String(next));
  };

  const handleRowProduct = (idx, pid) => {
    const prod = products.find((p) => String(p.id) === String(pid));
    clearAmountEdit(idx);
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              ...it,
              product_id: pid,
              sale_unit_id: prod?.unit_id ? String(prod.unit_id) : it.sale_unit_id,
              price_override: undefined
            }
          : it
      )
    );
  };

  const addProductToBill = (prod) => {
    if (!prod) return;
    setAmountEdits({});
    setItems((prev) => {
      const existing = prev.find(
        (it) =>
          String(it.product_id) === String(prod.id) &&
          String(it.sale_unit_id || "") === String(prod.unit_id || "")
      );
      if (existing) {
        return prev.map((it) =>
          it === existing ? { ...it, qty: String(Math.round(((Number(it.qty) || 1) + 1) * 1000000) / 1000000) } : it
        );
      }
      return [{ product_id: String(prod.id), qty: "1", sale_unit_id: String(prod.unit_id || "") }, ...prev];
    });
  };

  const quickSelect = (pid) => {
    const prod = products.find((p) => String(p.id) === String(pid));
    setQuickAdd("");
    if (!prod) return;
    addProductToBill(prod);
  };

  const scanProduct = async (code, { quiet = false } = {}) => {
    if (itemsLocked) {
      if (!quiet) setError("This bill has returned items, so its lines are locked.");
      return false;
    }
    if (!quiet) setError(null);
    try {
      const needle = String(code || "").trim().toLowerCase();
      let prod = products.find((p) =>
        [p.barcode, p.sku].some((value) => String(value || "").trim().toLowerCase() === needle)
      );
      if (!prod) {
        prod = await api.productByBarcode(code);
        setProducts((prev) =>
          prev.some((p) => String(p.id) === String(prod.id)) ? prev : [...prev, prod]
        );
      }
      if (Number(prod.selling_price) <= 0) {
        setError(`${prod.name} has no selling price. Set a price in Products before billing it.`);
        return false;
      }
      addProductToBill(prod);
      return true;
    } catch (e) {
      if (!quiet) setError(e.message);
      return false;
    }
  };

  const allCustomers = useMemo(() => {
    const seen = new Set(customers.map((c) => String(c.id)));
    return [...customers, ...scannedCustomers.filter((c) => !seen.has(String(c.id)))];
  }, [customers, scannedCustomers]);

  const selectedCustomer = useMemo(
    () => allCustomers.find((c) => String(c.id) === String(customerId)),
    [allCustomers, customerId]
  );

  const scanCustomer = async (code, { quiet = false } = {}) => {
    const trimmed = String(code || "").trim();
    if (!trimmed) return false;
    if (!quiet) setCustomerScanErr(null);
    try {
      const found = await api.customerByBarcode(trimmed);
      setScannedCustomers((prev) =>
        prev.some((c) => String(c.id) === String(found.id)) ? prev : [...prev, found]
      );
      setCustomerId(String(found.id));
      setCustomerScanErr(null);
      return true;
    } catch (err) {
      if (!quiet) setCustomerScanErr(err.message || "No customer found with that barcode");
      return false;
    }
  };

  const customPriceOf = (p) => {
    if (!p || !selectedCustomer?.category_id) return null;
    const row = (Array.isArray(p.category_prices) ? p.category_prices : []).find(
      (cp) => String(cp.category_id) === String(selectedCustomer.category_id)
    );
    if (!row || !(Number(row.selling_price) > 0)) return null;
    return Number(row.selling_price);
  };

  const usesStandardPrice = (p) =>
    !!(p && selectedCustomer?.category_id && customPriceOf(p) == null);

  const finalPriceOf = (p) => {
    if (!p) return 0;
    const override = customPriceOf(p);
    const baseSelling = override != null ? override : (Number(p.selling_price) || 0);
    const base = Math.max(baseSelling - (Number(p.discount) || 0), 0);
    return Math.round((base + (base * (Number(p.tax) || 0)) / 100) * 100) / 100;
  };

  const hasPriceOverride = (it) =>
    it?.price_override !== undefined &&
    it?.price_override !== null &&
    String(it.price_override).trim() !== "" &&
    Number.isFinite(Number(it.price_override));

  const priceOf = (it) => {
    if (itemsLocked) return Number(it.unit_price) || 0;
    if (hasPriceOverride(it)) return Math.max(0, Number(it.price_override) || 0);
    return finalPriceOf(getProduct(it.product_id));
  };
  const availableOf = (it) => {
    const p = getProduct(it.product_id);
    if (!p) return 0;
    const factor = Number(p.unit_factor);
    const allowance =
      String(p.unit_category || "").toLowerCase() === "weight" && factor > 0
        ? 1 / factor
        : 0;
    const unused = Math.max(0, allowance - (Number(p.oversold_qty) || 0));
    return Math.round((Math.max(0, Number(p.stock) || 0) + unused) * 1000000) / 1000000;
  };
  const marketOf = (it) =>
    itemsLocked ? Number(it.market_price) || 0 : Number(getProduct(it.product_id)?.market_price) || 0;

  const lineTotal = (it) =>
    Math.round(priceOf(it) * (Number(it.qty) || 0) * 100) / 100;

  const lineSave = (it) => {
    const savePerUnit = Math.max(0, marketOf(it) - priceOf(it));
    return Math.round(savePerUnit * Number(it.qty) * 100) / 100;
  };

  const total = items.reduce((a, it) => a + lineTotal(it), 0);
  const totalSaved = Math.round(items.reduce((a, it) => a + lineSave(it), 0) * 100) / 100;
  const itemCount = items.reduce((a, it) => a + (Number(it.qty) || 0), 0);

  const voucherDiscount = useMemo(() => {
    if (itemsLocked) return Number(sale.voucher_discount) || 0;
    if (!voucherApp) return 0;
    return voucherApp.discount_type === "percent"
      ? Math.round((total * voucherApp.discount_value) / 100 * 100) / 100
      : Math.min(voucherApp.discount_value, total);
  }, [voucherApp, total, itemsLocked, sale?.voucher_discount]);

  const grandTotal = itemsLocked
    ? Number(sale.total) || 0
    : Math.max(0, Math.round((total - voucherDiscount) * 100) / 100);

  const existingPointsDiscount = isEdit ? Number(sale.points_discount) || 0 : 0;
  const existingPointsRedeemed = isEdit ? Math.trunc(Number(sale.points_redeemed) || 0) : 0;
  const maxRedeemPoints = !isEdit && pointsInfo ? maxRedeemablePoints(pointsInfo.lots, grandTotal) : 0;
  const appliedRedeemPoints = !isEdit ? Math.min(redeemPoints, maxRedeemPoints) : 0;
  const redeemCalc =
    !isEdit && pointsInfo
      ? pointsValueFor(pointsInfo.lots, appliedRedeemPoints)
      : { points: 0, discount: 0, used: [] };
  const pointsDiscount = isEdit ? existingPointsDiscount : redeemCalc.discount;
  const amountDue = itemsLocked
    ? grandTotal
    : Math.max(0, Math.round((grandTotal - pointsDiscount) * 100) / 100);

  useEffect(() => {
    if (isEdit) return;
    setRedeemPoints(0);
    setPointsInfo(null);
    setPointsOpen(false);
  }, [customerId, isEdit]);

  useEffect(() => {
    if (isEdit || !pointsInfo) return;
    setRedeemPoints((prev) => Math.min(prev, maxRedeemablePoints(pointsInfo.lots, grandTotal)));
  }, [grandTotal, pointsInfo, isEdit]);

  const openRedeem = async () => {
    if (!selectedCustomer) return;
    setPointsErr(null);
    setPointsLoading(true);
    setPointsOpen(true);
    try {
      const info = await api.customerPoints(selectedCustomer.id);
      setPointsInfo(info);
    } catch (e) {
      setPointsErr(e.message);
    } finally {
      setPointsLoading(false);
    }
  };

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

  const productOptionFor = (p) => ({
    value: p.id,
    label: `${p.name} — ${fmtMoney(finalPriceOf(p))}${Number(p.stock) <= 0 ? " · out of stock" : ` · stock ${Math.round(p.stock)}`}`,
    searchText: p.name,
    keywords: [p.barcode, p.sku].filter(Boolean)
  });

  // Type-ahead product search. The server returns a small page, and every
  // result is merged into the bill's product map so pricing, stock and units
  // keep working exactly as they did when the whole catalogue was loaded.
  const searchProductOptions = async (query) => {
    const rows = await api.productSearch(query, 30);
    onProductsLoaded?.(rows);
    const onBill = new Set(items.map((it) => String(it.product_id)));
    return rows
      .filter((p) => Number(p.selling_price) > 0 || (isEdit && onBill.has(String(p.id))))
      .map(productOptionFor);
  };

  const searchCustomerOptions = async (query) => {
    const rows = await api.customerSearch(query, 30);
    onCustomersLoaded?.(rows);
    return rows.map((c) => ({
      value: c.id,
      label: c.phone ? `${c.name} · ${c.phone}` : c.name,
      searchText: c.name,
      keywords: [c.phone, c.barcode, c.card_no].filter(Boolean)
    }));
  };

  const submitSale = async (overrides = {}) => {
    if (submittingRef.current || saving) return;
    const validItems = items.filter((it) => it.product_id);
    if (!itemsLocked && validItems.length === 0) {
      setError("Add at least one product");
      return;
    }
    submittingRef.current = true;
    setError(null);
    try {
      const payload = {
        customer_id: customerId || null,
        payment_method: paymentMethod,
        status: overrides.status ?? status,
        note: note.trim() || null
      };
      if (!itemsLocked) {
        payload.items = [...validItems].reverse().map((it) => ({
          product_id: Number(it.product_id),
          qty: Number(it.qty) || 1,
          sale_unit_id: it.sale_unit_id || null,
          ...(hasPriceOverride(it) ? { unit_price: Number(it.price_override) } : {})
        }));
      }
      if (!isEdit) {
        payload.voucher_code = voucherApp ? voucherApp.code : null;
        if (appliedRedeemPoints > 0) payload.redeem_points = appliedRedeemPoints;
      }
      await onSave(payload);
      await draft.clear();
    } catch (err) {
      setError(err.message);
    } finally {
      submittingRef.current = false;
    }
  };

  const handleBillScan = async (raw) => {
    const code = String(raw || "")
      .trim()
      .replace(/^\*+|\*+$/g, "")
      .replace(/^\][A-Z]\d/i, "");
    if (!code) return;
    const upper = code.toUpperCase();
    if (matchGlobalScanCommand(upper)) {
      customerScanRef.current?.focus();
      return;
    }
    const command = matchSalesCommand(upper);
    if (command) {
      if (command.id === "create") {
        await submitSale();
      } else if (command.id === "paid") {
        setStatus("paid");
        await submitSale({ status: "paid" });
      } else if (command.id === "print") {
        onPrintLast?.();
      }
      return;
    }
    if (upper.startsWith("CMD:")) {
      setError("Unknown command barcode");
      return;
    }
    setError(null);
    setCustomerScanErr(null);
    if (upper.startsWith("CT")) {
      await scanCustomer(code);
      return;
    }
    if (upper.startsWith("BT")) {
      await scanProduct(code);
      return;
    }
    if (/^\d{4,6}$/.test(code)) {
      if (await scanCustomer(code, { quiet: true })) return;
      if (await scanProduct(code, { quiet: true })) return;
      setError("No customer or product found for that code");
      return;
    }
    if (await scanProduct(code, { quiet: true })) return;
    if (await scanCustomer(code, { quiet: true })) return;
    setError("No customer or product found for that code");
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitSale();
  };

  useScannerCapture({
    enabled: !addCustomerOpen && !pointsOpen && !saving,
    onScan: handleBillScan
  });

  const renderProductCell = (it, idx) => {
    const overStock = it.product_id && Number(it.qty) > availableOf(it);
    return (
      <div className="min-w-0 flex-1">
        <SearchableSelect
          value={it.product_id}
          onChange={(e) => handleRowProduct(idx, e.target.value)}
          options={[]}
          loadOptions={searchProductOptions}
          selectedLabel={(() => {
            const p = getProduct(it.product_id);
            return p ? productOptionFor(p).label : "";
          })()}
          placeholder="Select product"
          searchPlaceholder="Search or scan barcode..."
          onBarcode={handleBillScan}
          disabled={itemsLocked}
        />
        {overStock && (
          <p className="mt-1 text-[11px] font-medium text-amber-600">
            Only {fmtQty(availableOf(it))}
            {getProduct(it.product_id)?.unit ? ` ${getProduct(it.product_id).unit}` : ""} available
          </p>
        )}
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
            disabled={itemsLocked}
            className="px-2 py-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
            aria-label="Decrease"
          >
            <Minus className="h-4 w-3.5" />
          </button>
          <input
            type="number"
            min="0.000001"
            step="any"
            value={it.qty}
            disabled={itemsLocked}
            onChange={(e) => setQty(idx, e.target.value)}
            className="w-14 border-x border-slate-200 py-1.5 text-center text-sm text-slate-800 outline-none focus:bg-indigo-50/40 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button
            type="button"
            onClick={() => bumpQty(idx, 1)}
            disabled={itemsLocked}
            className="px-2 py-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
            aria-label="Increase"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {unit && <span className="w-8 text-xs font-medium text-slate-400">{unit.short_name}</span>}
      </div>
    );
  };

  const renderRate = (it, idx) => {
    const p = getProduct(it.product_id);
    const overridden = hasPriceOverride(it);
    const hasDraft = it.price_override !== undefined && it.price_override !== null;
    return (
      <div className="flex flex-col items-end gap-0.5">
        <input
          type="number"
          min="0"
          step="0.01"
          value={hasDraft ? String(it.price_override) : p ? String(priceOf(it)) : ""}
          disabled={itemsLocked || !p}
          onChange={(e) => setRate(idx, e.target.value)}
          onBlur={() => {
            if (!hasPriceOverride(it)) resetRate(idx);
          }}
          className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
          aria-label="Rate"
        />
        {overridden ? (
          <button
            type="button"
            onClick={() => resetRate(idx)}
            disabled={itemsLocked}
            className="text-[10px] font-semibold text-indigo-500 transition hover:text-indigo-700 disabled:opacity-40"
          >
            custom · reset
          </button>
        ) : p && customPriceOf(p) != null ? (
          <p className="text-[10px] font-semibold text-indigo-500">
            {selectedCustomer?.category_name || "Special"} price
          </p>
        ) : usesStandardPrice(p) ? (
          <p
            className="text-[10px] font-medium text-slate-400"
            title={`No ${selectedCustomer?.category_name} price set for this product`}
          >
            standard price
          </p>
        ) : null}
      </div>
    );
  };

  const renderAmount = (it, idx) => {
    const p = getProduct(it.product_id);
    const value = amountEdits[idx] !== undefined ? amountEdits[idx] : p ? String(lineTotal(it)) : "";
    return (
      <div className="flex flex-col items-end gap-0.5">
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          disabled={itemsLocked || !p}
          onChange={(e) => setAmount(idx, e.target.value)}
          onBlur={() => clearAmountEdit(idx)}
          className={`w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm font-bold outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400 ${
            it.product_id && Number(it.qty) > availableOf(it) ? "text-amber-600" : "text-slate-800"
          }`}
          aria-label="Line amount"
        />
        {p && lineSave(it) > 0 && (
          <p className="text-[10px] font-semibold text-emerald-600">save {fmtMoney(lineSave(it))}</p>
        )}
      </div>
    );
  };

  const closeQuickAdd = () => {
    if (customerSaving) return;
    setAddCustomerOpen(false);
    setNewCustomerName("");
    setNewCustomerPhone("");
    setCustomerErr(null);
  };

  const createQuickCustomer = async (e) => {
    e.preventDefault();
    const name = newCustomerName.trim();
    if (!name) {
      setCustomerErr("Customer name is required");
      return;
    }
    setCustomerSaving(true);
    setCustomerErr(null);
    try {
      const phone = newCustomerPhone.trim() || null;
      const created = await api.createCustomer({ name, phone });
      onCustomerCreated?.({ ...created, name, phone });
      setCustomerId(String(created.id));
      setAddCustomerOpen(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
    } catch (err) {
      setCustomerErr(err.message);
    } finally {
      setCustomerSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => (addCustomerOpen ? closeQuickAdd() : onClose())}
      title={isEdit ? "Edit Sale" : "New Sale"}
      subtitle={
        isEdit
          ? `Invoice ${sale.invoice_no} · change items, customer, payment, status or note`
          : "Search and add products to build the bill"
      }
      wide
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {items.length} line{items.length === 1 ? "" : "s"} · total qty {fmtQty(itemCount)}
            </p>
            {totalSaved > 0 && (
              <p className="text-xs font-semibold text-emerald-600">Saves vs MRP {fmtMoney(totalSaved)}</p>
            )}
            {voucherApp && (
              <p className="text-xs font-semibold text-indigo-600">
                Voucher {voucherApp.code} · {voucherApp.campaign_name} · −{fmtMoney(voucherDiscount)} off
              </p>
            )}
            {pointsDiscount > 0 && (
              <p className="text-xs font-semibold text-rose-600">
                Points redeemed ({isEdit ? existingPointsRedeemed : appliedRedeemPoints}) · −
                {fmtMoney(pointsDiscount)} off
              </p>
            )}
            {(voucherDiscount > 0 || pointsDiscount > 0) && total !== amountDue ? (
              <p className="text-lg font-bold tracking-tight text-slate-900">
                <span className="text-sm font-medium text-slate-400 line-through">{fmtMoney(total)}</span>{" "}
                {fmtMoney(amountDue)}
              </p>
            ) : (
              <p className="text-lg font-bold tracking-tight text-slate-900">{fmtMoney(amountDue)}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="new-sale-form" disabled={saving}>
              <ShoppingCart className="h-4 w-4" />
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Sale"}
            </Button>
          </div>
        </div>
      }
    >
      <DraftBanner draft={draft} />
      <form id="new-sale-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">Customer</span>
              <button
                type="button"
                onClick={() => {
                  setCustomerErr(null);
                  setCustomerScanErr(null);
                  setAddCustomerOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-indigo-600 transition hover:bg-indigo-50"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            </div>
            <BarcodeScanInput
              inputRef={customerScanRef}
              onScan={handleBillScan}
              placeholder="Scan card or type card no…"
              className="mb-2"
            />
            <SearchableSelect
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setCustomerScanErr(null);
              }}
              options={[
                { value: "", label: "Walk-in (no customer)" },
                ...(selectedCustomer ? [{ value: selectedCustomer.id, label: selectedCustomer.name }] : [])
              ]}
              loadOptions={searchCustomerOptions}
              selectedLabel={selectedCustomer?.name || ""}
              placeholder="Walk-in (no customer)"
              searchPlaceholder="Search or scan customer barcode..."
              onBarcode={handleBillScan}
            />
            {customerScanErr && (
              <p className="mt-1.5 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
                {customerScanErr}
              </p>
            )}
            {selectedCustomer && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                  <Award className="h-3.5 w-3.5" />
                  {(Number(selectedCustomer.points) || 0).toLocaleString("en-US")} points
                  {selectedCustomer.card_no ? (
                    <span className="font-mono font-normal text-slate-400">· Card {selectedCustomer.card_no}</span>
                  ) : selectedCustomer.barcode ? (
                    <span className="font-mono font-normal text-slate-400">· {selectedCustomer.barcode}</span>
                  ) : null}
                </span>
                {!isEdit && Number(selectedCustomer.points) > 0 && (
                  <button
                    type="button"
                    onClick={openRedeem}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100"
                  >
                    <Coins className="h-3.5 w-3.5" /> Redeem
                  </button>
                )}
                {!isEdit && appliedRedeemPoints > 0 && (
                  <button
                    type="button"
                    onClick={() => setRedeemPoints(0)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100"
                  >
                    <X className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
                {isEdit && existingPointsRedeemed > 0 && (
                  <span className="text-[11px] font-semibold text-rose-600">
                    {existingPointsRedeemed.toLocaleString("en-US")} points used on this bill
                  </span>
                )}
              </div>
            )}
          </div>
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
                { value: "credit", label: "Credit" },
                ...(status === "booking" ? [{ value: "booking", label: "Booking" }] : [])
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
                {!isEdit && (
                  <button
                    type="button"
                    onClick={() => setVoucherApp(null)}
                    className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Remove voucher"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
              </div>
            ) : null}
          </div>
          {!voucherApp && !isEdit && (
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
          {isEdit && !voucherApp && (
            <p className="mt-2 text-xs text-slate-400">No voucher was used on this bill.</p>
          )}
          {voucherErr && <p className="mt-2 text-xs font-medium text-rose-600">{voucherErr}</p>}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <p className="text-sm font-semibold text-slate-700">{itemsLocked ? "Items locked" : "Add Products"}</p>
            <span className="text-[11px] font-medium text-slate-400">
              {itemsLocked ? "Returned items prevent line edits" : "Pick a product to add it to the bill"}
            </span>
          </div>

          {itemsLocked && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              This bill has returned items, so its lines are locked. You can still change the customer,
              payment, status and note.
            </p>
          )}

          {!itemsLocked && (
            <div className="space-y-2">
              <BarcodeScanInput
                onScan={handleBillScan}
                placeholder="Scan a product barcode to add it to the bill…"
              />
              <SearchableSelect
                value={quickAdd}
                onChange={(e) => quickSelect(e.target.value)}
                options={[{ value: "", label: "Select a product to add" }]}
                loadOptions={searchProductOptions}
                placeholder="Search & add a product…"
                searchPlaceholder="Search or scan product barcode…"
                onBarcode={handleBillScan}
                className="w-full"
              />
            </div>
          )}

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
                      const overStock = it.product_id && Number(it.qty) > availableOf(it);
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
                              disabled={itemsLocked}
                            />
                          </td>
                          <td className="px-3 py-2 text-right align-top">
                            {marketOf(it) > 0 ? (
                              <span className="text-slate-400">{fmtMoney(marketOf(it))}</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right align-top">{renderRate(it, idx)}</td>
                          <td className="px-3 py-2 text-right align-top">{renderAmount(it, idx)}</td>
                          <td className="px-2 py-2 align-top">
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              disabled={itemsLocked}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
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
                  const overStock = it.product_id && Number(it.qty) > availableOf(it);
                  return (
                    <div key={idx} className={`rounded-2xl border p-3 shadow-sm ${overStock ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">{renderProductCell(it, idx)}</div>
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          disabled={itemsLocked}
                          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
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
                          disabled={itemsLocked}
                        />
                      </div>
                      <div className="mt-2 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 text-xs">
                          {p && marketOf(it) > 0 && (
                            <span className="text-slate-400">MRP: <span className="font-semibold text-slate-600">{fmtMoney(marketOf(it))}</span></span>
                          )}
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="text-right">
                            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rate</span>
                            {renderRate(it, idx)}
                          </div>
                          <div className="text-right">
                            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Amount</span>
                            {renderAmount(it, idx)}
                          </div>
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

      <RedeemPointsModal
        open={pointsOpen}
        onClose={() => setPointsOpen(false)}
        info={pointsInfo}
        loading={pointsLoading}
        error={pointsErr}
        maxDiscount={grandTotal}
        initialPoints={redeemPoints}
        onApply={(points) => {
          setRedeemPoints(points);
          setPointsOpen(false);
        }}
      />

      <Modal
        open={addCustomerOpen}
        onClose={closeQuickAdd}
        title="Add customer"
        subtitle="Create a customer without losing this bill"
        footer={
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={closeQuickAdd} disabled={customerSaving}>
              Cancel
            </Button>
            <Button type="submit" form="quick-add-customer-form" disabled={customerSaving}>
              {customerSaving ? "Adding…" : "Add & select"}
            </Button>
          </div>
        }
      >
        <form id="quick-add-customer-form" onSubmit={createQuickCustomer} className="space-y-3">
          <Field label="Name" required>
            <Input
              value={newCustomerName}
              onChange={(e) => setNewCustomerName(e.target.value)}
              placeholder="Customer name"
              autoFocus
            />
          </Field>
          <Field label="Phone (optional)">
            <Input
              value={newCustomerPhone}
              onChange={(e) => setNewCustomerPhone(e.target.value)}
              placeholder="Phone number"
              inputMode="tel"
            />
          </Field>
          {customerErr && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{customerErr}</p>
          )}
        </form>
      </Modal>
    </Modal>
  );
}

function MarkPaidModal({ sale, method, onMethodChange, saving, error, onConfirm, onClose }) {
  const due = Math.max(
    0,
    Math.round(((Number(sale.total) || 0) - (Number(sale.paid) || 0)) * 100) / 100
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Mark bill paid"
      subtitle={`${sale.invoice_no} · ${sale.customer || "Walk-in"}`}
      footer={
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={saving || due <= 0}
            className="!bg-emerald-600 hover:!bg-emerald-700"
          >
            <CreditCard className="h-4 w-4" />
            {saving ? "Saving…" : `Receive ${fmtMoney(due)}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5 rounded-2xl bg-slate-50 p-3.5 text-sm ring-1 ring-slate-200/70">
          <div className="flex justify-between">
            <span className="text-slate-500">Bill total</span>
            <span className="font-semibold text-slate-800">{fmtMoney(sale.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Already paid</span>
            <span className="font-semibold text-emerald-600">{fmtMoney(sale.paid)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5">
            <span className="font-semibold text-slate-700">Due now</span>
            <span className="text-lg font-bold text-rose-600">{fmtMoney(due)}</span>
          </div>
        </div>

        <Field label="Payment method">
          <SearchableSelect
            value={method}
            onChange={(e) => onMethodChange(e.target.value)}
            options={PAY_METHODS}
            placeholder="Select method"
            searchPlaceholder="Search methods..."
          />
        </Field>

        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}

// Line items for an expanded sale row. Shared by the desktop table and the
// mobile card list so both show the same breakdown.
function SaleItemsPanel({ items, sale, loading }) {
  if (loading) {
    return (
      <div className="space-y-2 py-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-50" />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return <p className="py-4 text-center text-sm text-slate-400">No items on this sale</p>;
  }

  const subtotal = items.reduce((a, it) => a + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0);
  const saved = items.reduce(
    (a, it) => a + Math.max(0, (Number(it.market_price) || 0) - (Number(it.unit_price) || 0)) * (Number(it.qty) || 0),
    0
  );

  return (
    <>
      <div className="hidden grid-cols-[1fr_8rem_7rem] gap-3 px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
        <span>Item</span>
        <span className="text-right">Qty × Rate</span>
        <span className="text-right">Amount</span>
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200/80">
        {items.map((it) => {
          const qty = Number(it.qty) || 0;
          const rate = Number(it.unit_price) || 0;
          const mrp = Number(it.market_price) || 0;
          const savedHere = Math.max(0, mrp - rate) * qty;
          return (
            <div
              key={it.id}
              className="grid grid-cols-1 gap-1 px-3 py-2.5 text-sm transition hover:bg-slate-50/60 sm:grid-cols-[1fr_8rem_7rem] sm:items-center sm:gap-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{it.product_name || "Item"}</p>
                <p className="truncate text-xs text-slate-400">
                  {it.hsn_code ? `HSN ${it.hsn_code}` : "No HSN"}
                  {Number(it.tax) ? ` · Tax ${it.tax}%` : ""}
                  {savedHere > 0 ? (
                    <span className="text-emerald-500"> · saved {fmtMoney(savedHere)}</span>
                  ) : null}
                </p>
              </div>
              <p className="text-xs text-slate-500 sm:text-right">
                {fmtQty(qty)} {it.unit_name || ""}
                <span className="text-slate-400"> × {fmtMoney(rate)}</span>
              </p>
              <p className="text-sm font-bold tabular-nums text-slate-800 sm:text-right">
                {fmtMoney(rate * qty)}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50 px-3.5 py-2.5 text-sm ring-1 ring-indigo-100">
        <span className="font-semibold text-slate-600">
          {items.length} {items.length === 1 ? "item" : "items"} · Subtotal {fmtMoney(subtotal)}
        </span>
        <span className="flex items-baseline gap-2">
          {saved > 0 && <span className="text-xs font-medium text-emerald-600">saved {fmtMoney(saved)}</span>}
          <span className="text-base font-bold tabular-nums text-indigo-700">{fmtMoney(Number(sale.total) || subtotal)}</span>
        </span>
      </div>
    </>
  );
}

function ViewSaleModal({ sale, onClose, onMarkPaid }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saleDetail, setSaleDetail] = useState(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.sale(sale.id);
        setItems(data.items || []);
        setSaleDetail(data);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [sale.id]);

const subtotal = items.reduce((a, it) => a + (Number(it.unit_price) * Number(it.qty)), 0);
  const totalProfit = items.reduce((a, it) => a + (Number(it.profit) || 0), 0);
  const returnedProfit = Number(saleDetail?.returned_profit ?? 0) || 0;
  const returnedTotal = Number(saleDetail?.returned_total ?? 0) || 0;
  // The detail endpoint (/sales/:id) computes the true numbers itself:
  // voucher_discount = what coupon codes took off this bill, and
  // total_profit = item profit − voucher discount − return profit. Use those
  // directly -- deriving the voucher from subtotal−total can misreport a bill
  // whose items or totals were corrected later. The derived formulas stay as a
  // fallback for the moment before the detail request resolves.
  const voucherDiscount = saleDetail
    ? Math.round((Number(saleDetail.voucher_discount) || 0) * 100) / 100
    : 0;
  const serverTotalProfit = saleDetail ? Number(saleDetail.total_profit) : null;
  const fallbackDiscount = Math.max(
    voucherDiscount,
    Math.round((Math.max(0, subtotal - (Number(sale.total) || subtotal))) * 100) / 100
  );
  const profitShown =
    serverTotalProfit != null
      ? Math.round(serverTotalProfit * 100) / 100
      : Math.max(0, totalProfit - fallbackDiscount - returnedProfit);
  const totalSaved = items.reduce((a, it) => {
    const savePerUnit = Math.max(0, (Number(it.market_price) || 0) - (Number(it.unit_price) || 0));
    return a + savePerUnit * Number(it.qty);
  }, 0);
  const paid = Number(sale.paid) || 0;
  const total = Number(sale.total) || subtotal;
  const discount = fallbackDiscount;
  const outstanding = total - paid;

  const printThermal = async () => {
    setPrinting(true);
    try {
      await printReceiptOnLaptop(saleDetail || sale, items, getStoreInfo());
    } catch (e) {
      alert(e.message || "Failed to print receipt");
    } finally {
      setPrinting(false);
    }
  };

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
                        <td className="px-4 py-2 text-right text-slate-600">{fmtQty(it.qty)} {it.unit_name || ""}</td>
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
                      <span>Qty: {fmtQty(it.qty)} {it.unit_name || ""}</span>
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
            <span className="font-semibold text-emerald-600">{fmtMoney(Math.max(0, profitShown))}</span>
          </div>
          {returnedTotal > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Returned (refund)</span>
              <span className="font-semibold text-emerald-600">− {fmtMoney(returnedTotal)}</span>
            </div>
          )}
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

        {outstanding > 0 &&
          sale.status !== "cancelled" &&
          !(sale.channel === "online" && sale.status === "booking") && (
            <Button
              variant="ghost"
              onClick={() => onMarkPaid(sale)}
              className="!bg-emerald-50 !text-emerald-700 hover:!bg-emerald-100"
            >
              <CreditCard className="h-4 w-4" /> Mark Paid · {fmtMoney(outstanding)}
            </Button>
          )}

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* Print from the fetched detail, not the list row we were opened
                with: the /sales list has no voucher attached, so printing the
                prop would silently drop the coupon off both layouts. */}
            <Button variant="soft" onClick={printThermal} disabled={printing}>
              <Printer className="h-4 w-4" /> {printing ? "Printing…" : "Receipt (58mm)"}
            </Button>
            <Button variant="soft" onClick={() => printInvoiceA4(saleDetail || sale, items, getStoreInfo())}>
              <FileText className="h-4 w-4" /> Invoice (A4)
            </Button>
            <Button
              variant="soft"
              onClick={() => sendWhatsApp(buildSaleWhatsAppText(getStoreInfo(), saleDetail || sale, items), sale.customer_phone)}
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