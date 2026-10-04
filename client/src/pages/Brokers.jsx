import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Phone,
  MapPin,
  Building2,
  Send,
  UserRound,
  Package,
  MessageSquareQuote,
  ClipboardList,
  Check,
  Trash
} from "lucide-react";
import { api } from "../api.js";
import { useDebouncedState } from "../lib/useDebounced.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { buildBrokerEnquiryText, sendWhatsApp as openWhatsApp } from "../lib/whatsapp.js";
import { fmtMoney, fmtDateTime } from "../lib/format.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";

const uid = () => Math.random().toString(36).slice(2, 9);

const localDate = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const EMPTY_BROKER = { name: "", company_name: "", phone: "", area: "", speciality: "", detail: "" };

const STATUS_META = {
  sent: { label: "Sent", cls: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-500" },
  ordered: { label: "Ordered", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  received: { label: "Received", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-500", dot: "bg-slate-400" }
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "sent", label: "Sent" },
  { value: "ordered", label: "Ordered" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" }
];

const copyToClipboard = (text) => {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* ignore */
    }
    document.body.removeChild(ta);
  }
};

export default function Brokers() {
  const [tab, setTab] = useState("enquire");

  const [brokers, setBrokers] = useState([]);
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // broker directory state
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [brokerOpen, setBrokerOpen] = useState(false);
  const [editingBroker, setEditingBroker] = useState(null);
  const [brokerForm, setBrokerForm] = useState(EMPTY_BROKER);
  const [brokerSaving, setBrokerSaving] = useState(false);
  const [brokerFormError, setBrokerFormError] = useState(null);
  const [toDeleteBroker, setToDeleteBroker] = useState(null);

  // enquiry builder state
  const [brokerId, setBrokerId] = useState("");
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState("");
  const [quickAdd, setQuickAdd] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  // enquiry history filters
  const [historyStatus, setHistoryStatus] = useState("");
  const [toDeleteEnquiry, setToDeleteEnquiry] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const loadBrokers = useCallback(async () => {
    try {
      setBrokers(await api.brokers());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const loadEnquiries = useCallback(async (status) => {
    try {
      setEnquiries(await api.brokerEnquiries(status ? { status } : undefined));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [p, u] = await Promise.all([api.productOptions(), api.measuringUnits()]);
        if (!active) return;
        setProducts(p || []);
        setUnits(u || []);
        setError(null);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    loadBrokers();
    return () => {
      active = false;
    };
  }, [loadBrokers]);

  useEffect(() => {
    loadEnquiries(historyStatus);
  }, [historyStatus, loadEnquiries]);

  // ── brokers directory ──────────────────────────────────────
  const filteredBrokers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return brokers;
    return brokers.filter((b) =>
      [b.name, b.company_name, b.area, b.speciality, b.phone].filter(Boolean).some((v) => v.toLowerCase().includes(q))
    );
  }, [brokers, debouncedSearch]);

  const openCreateBroker = () => {
    setEditingBroker(null);
    setBrokerForm(EMPTY_BROKER);
    setBrokerFormError(null);
    setBrokerOpen(true);
  };

  const openEditBroker = (b) => {
    setEditingBroker(b);
    setBrokerForm({
      name: b.name || "",
      company_name: b.company_name || "",
      phone: b.phone || "",
      area: b.area || "",
      speciality: b.speciality || "",
      detail: b.detail || ""
    });
    setBrokerFormError(null);
    setBrokerOpen(true);
  };

  const saveBroker = async (e) => {
    e.preventDefault();
    setBrokerSaving(true);
    setBrokerFormError(null);
    try {
      if (editingBroker) await api.updateBroker(editingBroker.id, brokerForm);
      else await api.createBroker(brokerForm);
      setBrokerOpen(false);
      setToast(editingBroker ? "Broker updated" : "Broker added");
      await loadBrokers();
    } catch (err) {
      setBrokerFormError(err.message);
    } finally {
      setBrokerSaving(false);
    }
  };

  const confirmDeleteBroker = async () => {
    try {
      await api.deleteBroker(toDeleteBroker.id);
      setToDeleteBroker(null);
      setToast("Broker deleted");
      await loadBrokers();
      await loadEnquiries(historyStatus);
    } catch (err) {
      setError(err.message);
      setToDeleteBroker(null);
    }
  };

  // ── enquiry builder ────────────────────────────────────────
  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: String(p.id),
        label: `${p.name}${p.stock > 0 ? ` · in stock ${Number(p.stock)}` : ""}`
      })),
    [products]
  );

  const unitOptions = useMemo(
    () => [
      { value: "", label: "Unit" },
      ...units.map((u) => ({ value: u.short_name, label: `${u.name} (${u.short_name})` }))
    ],
    [units]
  );

  const findProduct = (id) => products.find((p) => String(p.id) === String(id));

  const selectedBroker = useMemo(() => brokers.find((b) => String(b.id) === String(brokerId)), [
    brokers,
    brokerId
  ]);

  const updateItem = (id, field, value) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));

  const pickProduct = (id, productId) => {
    const prod = findProduct(productId);
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              product_id: String(prod ? prod.id : ""),
              product_name: prod ? prod.name : it.product_name,
              // Brokers quote in whole bags/boxes far more often than in kilos,
              // so default to the product's own unit and let it be overridden.
              unit_name: prod ? prod.unit || it.unit_name || "" : it.unit_name,
              rate: prod && it.rate === "" ? String(Number(prod.purchase_price) || "") : it.rate
            }
          : it
      )
    );
  };

  const quickAddProduct = (productId) => {
    if (productId) {
      const prod = findProduct(productId);
      setItems((prev) => [
        ...prev,
        {
          id: uid(),
          product_id: String(productId),
          product_name: prod ? prod.name : "",
          qty: "1",
          unit_name: prod ? prod.unit || "" : "",
          rate: prod ? String(Number(prod.purchase_price) || "") : "",
          note: ""
        }
      ]);
    }
    setQuickAdd("");
  };

  const removeItem = (id) => setItems((prev) => prev.filter((it) => it.id !== id));

  const clearBuilder = () => {
    setItems([]);
    setNotes("");
    setSendError(null);
  };

  const filledItems = useMemo(
    () =>
      items
        .filter((it) => it.product_name.trim() && (Number(it.qty) || 0) > 0)
        .map((it) => ({
          product_id: it.product_id || null,
          product_name: it.product_name.trim(),
          qty: Number(it.qty) || 0,
          unit_name: it.unit_name.trim(),
          rate: Number(it.rate) || 0,
          note: it.note.trim()
        })),
    [items]
  );

  const estimated = useMemo(
    () => filledItems.reduce((a, it) => a + it.qty * it.rate, 0),
    [filledItems]
  );

  const message = useMemo(
    () => buildBrokerEnquiryText(getStoreInfo(), { date: localDate(), notes: notes.trim(), items: filledItems }),
    [notes, filledItems]
  );

  const submitEnquiry = async (alsoSend) => {
    setSendError(null);
    if (!brokerId) {
      setSendError("Choose a broker to send this enquiry to");
      return;
    }
    if (filledItems.length === 0) {
      setSendError("Add at least one product with a quantity");
      return;
    }
    setSending(true);
    try {
      const saved = await api.createBrokerEnquiry({ broker_id: Number(brokerId), notes: notes.trim(), items: filledItems });
      if (alsoSend) {
        const broker = brokers.find((b) => String(b.id) === String(brokerId));
        copyToClipboard(message);
        openWhatsApp(message, broker?.phone || "");
      }
      setToast(`Enquiry ${saved.reference_no} saved${alsoSend ? " — copied, paste into WhatsApp" : ""}`);
      clearBuilder();
      await Promise.all([loadBrokers(), loadEnquiries(historyStatus)]);
      setTab("history");
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  // ── history actions ────────────────────────────────────────
  const changeStatus = async (enquiry, status) => {
    try {
      await api.updateBrokerEnquiryStatus(enquiry.id, status);
      setToast(`Enquiry marked ${STATUS_META[status].label.toLowerCase()}`);
      await loadEnquiries(historyStatus);
      await loadBrokers();
    } catch (err) {
      setError(err.message);
    }
  };

  const resendEnquiry = async (enquiry) => {
    try {
      const full = await api.brokerEnquiry(enquiry.id);
      const text = buildBrokerEnquiryText(getStoreInfo(), {
        referenceNo: full.reference_no,
        date: localDate(),
        notes: full.notes,
        items: full.items || []
      });
      copyToClipboard(text);
      openWhatsApp(text, full.broker_phone || "");
    } catch (err) {
      setError(err.message);
    }
  };

  const confirmDeleteEnquiry = async () => {
    try {
      await api.deleteBrokerEnquiry(toDeleteEnquiry.id);
      setToDeleteEnquiry(null);
      setToast("Enquiry deleted");
      await loadEnquiries(historyStatus);
      await loadBrokers();
    } catch (err) {
      setError(err.message);
      setToDeleteEnquiry(null);
    }
  };

  const tabs = [
    { key: "enquire", label: "Send Enquiry", icon: MessageSquareQuote },
    { key: "brokers", label: `Brokers (${brokers.length})`, icon: UserRound },
    { key: "history", label: "Enquiry History", icon: ClipboardList }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <UserRound className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Brokers &amp; Purchase Enquiry</p>
            <p className="text-xs text-slate-500">Ask a broker for stock — pick products, set quantity, send on WhatsApp</p>
          </div>
        </div>
        <Button onClick={openCreateBroker}>
          <Plus className="h-4 w-4" /> Add Broker
        </Button>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200/70">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                active ? "bg-indigo-600 text-white shadow" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <Card className="text-sm text-rose-600">
          {error}
          <button className="ml-2 font-semibold underline" onClick={() => window.location.reload()}>
            Retry
          </button>
        </Card>
      )}

      {/* ── SEND ENQUIRY ──────────────────────────────────────── */}
      {tab === "enquire" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="space-y-4">
            <Card className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Send to</p>
              {brokers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                  <UserRound className="mx-auto h-6 w-6 text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-slate-600">No brokers yet</p>
                  <p className="mt-1 text-xs text-slate-400">Add a broker with a WhatsApp number to start sending enquiries.</p>
                  <Button className="mt-3" onClick={openCreateBroker}>
                    <Plus className="h-4 w-4" /> Add Broker
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field label="Broker" required>
                      <SearchableSelect
                        value={brokerId}
                        onChange={(e) => setBrokerId(e.target.value)}
                        options={[{ value: "", label: "Choose a broker…" }, ...brokers.map((b) => ({
                          value: String(b.id),
                          label: `${b.name}${b.area ? ` · ${b.area}` : ""}`
                        }))]}
                        placeholder="Choose a broker…"
                        searchPlaceholder="Search brokers…"
                      />
                    </Field>
                  </div>
                  {selectedBroker && (
                    <div className="sm:col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-slate-400" /> {selectedBroker.phone}
                      </span>
                      {selectedBroker.speciality && (
                        <span className="flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5 text-slate-400" /> {selectedBroker.speciality}
                        </span>
                      )}
                      {selectedBroker.area && (
                        <span className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-slate-400" /> {selectedBroker.area}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Items required
                  {items.length > 0 && (
                    <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                      {items.length}
                    </span>
                  )}
                </p>
                {items.length > 0 && (
                  <button
                    onClick={clearBuilder}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-rose-600"
                  >
                    <Trash className="h-3.5 w-3.5" /> Clear all
                  </button>
                )}
              </div>

              <div className="border-b border-slate-100 p-3">
                <Field label="Quick add — search a product to request (qty 1)">
                  <SearchableSelect
                    value={quickAdd}
                    onChange={(e) => quickAddProduct(e.target.value)}
                    options={[{ value: "", label: "Search & add product…" }, ...productOptions.filter((o) => o.value !== "")]}
                    placeholder="Search & add product…"
                    searchPlaceholder="Type to search products…"
                  />
                </Field>
              </div>

              <div className="space-y-2 p-3">
                {loading ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="py-8 text-center">
                    <Package className="mx-auto h-7 w-7 text-slate-300" />
                    <p className="mt-2 text-sm text-slate-500">No products added yet.</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Search a product above, e.g. add Rice and set 2 bags.
                    </p>
                  </div>
                ) : (
                  items.map((it) => (
                    <div
                      key={it.id}
                      className="grid grid-cols-2 items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2 sm:grid-cols-12"
                    >
                      <div className="col-span-2 space-y-1.5 sm:col-span-5">
                        <SearchableSelect
                          value={it.product_id}
                          onChange={(e) => pickProduct(it.id, e.target.value)}
                          options={[{ value: "", label: "Custom item (type below)" }, ...productOptions]}
                          placeholder="Choose product…"
                          searchPlaceholder="Search products…"
                        />
                        <Input
                          value={it.product_name}
                          onChange={(e) => updateItem(it.id, "product_name", e.target.value)}
                          placeholder="Item / description"
                          className="!py-2 text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={it.qty}
                          onChange={(e) => updateItem(it.id, "qty", e.target.value)}
                          placeholder="Qty"
                          className="!py-2 text-xs"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <SearchableSelect
                          value={it.unit_name}
                          onChange={(e) => updateItem(it.id, "unit_name", e.target.value)}
                          options={unitOptions}
                          placeholder="Unit"
                          searchPlaceholder="Search units…"
                        />
                      </div>
                      <div className="col-span-1 sm:col-span-1">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={it.rate}
                          onChange={(e) => updateItem(it.id, "rate", e.target.value)}
                          placeholder="Rate"
                          className="!py-2 text-xs"
                        />
                      </div>
                      <div className="col-span-1 flex items-center justify-end sm:col-span-1">
                        <button
                          onClick={() => removeItem(it.id)}
                          aria-label="Remove item"
                          className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="col-span-2 sm:col-span-12">
                        <Input
                          value={it.note}
                          onChange={(e) => updateItem(it.id, "note", e.target.value)}
                          placeholder="Note for the broker — brand, grade, packing date…"
                          className="!py-2 text-xs"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Message</p>
              <Field label="Notes / instructions for the broker">
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Need Sella basmati, prefer new stock. Delivery before Sunday please."
                />
              </Field>

              {filledItems.length > 0 && (
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                  <span className="text-slate-500">Estimated value at listed rate</span>
                  <span className="font-bold text-slate-800">{estimated > 0 ? fmtMoney(estimated) : "—"}</span>
                </div>
              )}

              {sendError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{sendError}</p>}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => submitEnquiry(true)} disabled={sending} className="flex-1">
                  <Send className="h-4 w-4" /> {sending ? "Sending…" : "Save & Send WhatsApp"}
                </Button>
                <Button variant="ghost" onClick={() => submitEnquiry(false)} disabled={sending} className="flex-1">
                  Save only
                </Button>
              </div>
            </Card>
          </div>

          {/* live preview */}
          <div className="xl:sticky xl:top-4 xl:self-start">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">WhatsApp preview</p>
                {filledItems.length > 0 && (
                  <span className="text-[11px] font-semibold text-slate-400">{filledItems.length} item(s)</span>
                )}
              </div>
              <div className="bg-slate-100 p-4 sm:p-5">
                <div className="mx-auto max-w-sm rounded-2xl rounded-bl-sm bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <div className="accent-banner mb-3 h-1 rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-500" />
                  <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-slate-700">
                    {message}
                  </pre>
                  <p className="mt-3 text-right text-[10px] text-slate-400">10:32 AM ✓✓</p>
                </div>
              </div>
            </Card>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
              <Check className="h-3.5 w-3.5 shrink-0" />
              Message is copied to the clipboard so you can paste it if the prefill is missing.
            </div>
          </div>
        </div>
      )}

      {/* ── BROKER DIRECTORY ──────────────────────────────────── */}
      {tab === "brokers" && (
        <>
          <div className="relative sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search brokers…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {filteredBrokers.length === 0 ? (
            <Card className="py-14 text-center text-sm text-slate-500">
              {brokers.length === 0 ? "No brokers added yet." : "No brokers match your search."}
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredBrokers.map((b) => (
                <Card key={b.id} className="animate-fade-up flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                        <UserRound className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">{b.name}</h3>
                        {b.company_name && (
                          <p className="flex items-center gap-1 text-xs text-slate-500">
                            <Building2 className="h-3 w-3" /> {b.company_name}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditBroker(b)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setToDeleteBroker(b)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-slate-400" /> {b.phone}
                    </p>
                    {b.area && (
                      <p className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> {b.area}
                      </p>
                    )}
                    {b.speciality && (
                      <p className="flex items-start gap-1.5">
                        <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> {b.speciality}
                      </p>
                    )}
                  </div>

                  {b.detail && <p className="mt-2 line-clamp-2 text-xs text-slate-400">{b.detail}</p>}

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                    <span className="text-slate-400">
                      {b.enquiry_count} enquir{b.enquiry_count === 1 ? "y" : "ies"}
                    </span>
                    <button
                      onClick={() => {
                        setBrokerId(String(b.id));
                        setTab("enquire");
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 font-semibold text-indigo-700 transition hover:bg-indigo-100"
                    >
                      <Send className="h-3.5 w-3.5" /> Send enquiry
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── HISTORY ───────────────────────────────────────────── */}
      {tab === "history" && (
        <Card className="!p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Enquiry history
              {enquiries.length > 0 && (
                <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">
                  {enquiries.length}
                </span>
              )}
            </p>
            <div className="w-full sm:w-48">
              <SearchableSelect
                value={historyStatus}
                onChange={(e) => setHistoryStatus(e.target.value)}
                options={STATUS_OPTIONS}
                placeholder="All statuses"
                searchPlaceholder="Search status…"
              />
            </div>
          </div>

          {enquiries.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-500">No enquiries found.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {enquiries.map((e) => {
                const meta = STATUS_META[e.status] || STATUS_META.sent;
                return (
                  <div key={e.id} className="p-4 transition hover:bg-slate-50/60">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{e.broker_name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}>
                            {meta.label}
                          </span>
                          {e.reference_no && (
                            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                              {e.reference_no}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                          <span>{fmtDateTime(e.created_at)}</span>
                          <span>
                            {e.item_count} item{e.item_count === 1 ? "" : "s"} · {Number(e.total_qty)} total qty
                          </span>
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {e.broker_phone}
                          </span>
                        </p>
                        {e.notes && <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{e.notes}</p>}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <SearchableSelect
                          value={e.status}
                          onChange={(ev) => changeStatus(e, ev.target.value)}
                          options={STATUS_OPTIONS.filter((o) => o.value)}
                          placeholder="Status"
                          searchPlaceholder="Search status…"
                          className="w-32"
                        />
                        <button
                          onClick={() => resendEnquiry(e)}
                          className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                        >
                          <Send className="h-3.5 w-3.5" /> Send again
                        </button>
                        <button
                          onClick={() => setToDeleteEnquiry(e)}
                          aria-label="Delete enquiry"
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Modal
        open={brokerOpen}
        onClose={() => setBrokerOpen(false)}
        title={editingBroker ? "Edit Broker" : "Add Broker"}
        subtitle="Name and WhatsApp number — everything else is optional"
        wide
      >
        <form onSubmit={saveBroker} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Broker name" required>
              <Input
                value={brokerForm.name}
                onChange={(e) => setBrokerForm({ ...brokerForm, name: e.target.value })}
                required
                placeholder="e.g. Ramesh Traders"
              />
            </Field>
            <Field label="Company name">
              <Input
                value={brokerForm.company_name}
                onChange={(e) => setBrokerForm({ ...brokerForm, company_name: e.target.value })}
                placeholder="e.g. Ramesh Agro Agency"
              />
            </Field>
            <Field label="WhatsApp number" required hint="Used to send purchase enquiries">
              <Input
                value={brokerForm.phone}
                onChange={(e) => setBrokerForm({ ...brokerForm, phone: e.target.value })}
                required
                placeholder="03xx-xxxxxxx"
              />
            </Field>
            <Field label="Area / market">
              <Input
                value={brokerForm.area}
                onChange={(e) => setBrokerForm({ ...brokerForm, area: e.target.value })}
                placeholder="e.g. Azadpur Grain Market"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Deals in" hint="Comma separated — e.g. Rice, Sugar, Cooking oil">
                <Input
                  value={brokerForm.speciality}
                  onChange={(e) => setBrokerForm({ ...brokerForm, speciality: e.target.value })}
                  placeholder="Rice, Wheat, Sugar"
                />
              </Field>
            </div>
          </div>
          <Field label="Detail">
            <Textarea
              value={brokerForm.detail}
              onChange={(e) => setBrokerForm({ ...brokerForm, detail: e.target.value })}
              placeholder="Payment terms, delivery days, commission, minimum order…"
            />
          </Field>

          {brokerFormError && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{brokerFormError}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={() => setBrokerOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={brokerSaving}>
              {brokerSaving ? "Saving…" : editingBroker ? "Update Broker" : "Add Broker"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDeleteBroker}
        title="Delete broker?"
        message={`"${toDeleteBroker?.name}" and all their enquiry history will be removed.`}
        onConfirm={confirmDeleteBroker}
        onCancel={() => setToDeleteBroker(null)}
      />

      <ConfirmDialog
        open={!!toDeleteEnquiry}
        title="Delete enquiry?"
        message={`Enquiry ${toDeleteEnquiry?.reference_no || ""} will be removed from the history.`}
        onConfirm={confirmDeleteEnquiry}
        onCancel={() => setToDeleteEnquiry(null)}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
