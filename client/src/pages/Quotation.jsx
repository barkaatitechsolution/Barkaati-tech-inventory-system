import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Trash2, Printer, Send, Check, StickyNote } from "lucide-react";
import { api } from "../api.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { printQuotationA4 } from "../lib/receipt.js";
import { buildQuotationWhatsAppText, sendWhatsApp as openWhatsApp } from "../lib/whatsapp.js";
import { fmtMoney, fmtDate } from "../lib/format.js";
import Card from "../components/Card.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";

const uid = () => Math.random().toString(36).slice(2, 9);

const localDate = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const addDays = (iso, days) => {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const generateNo = () => {
  const ymd = localDate().replace(/-/g, "").slice(2);
  const seq = String(Math.floor(100 + Math.random() * 900));
  return `QT-${ymd}-${seq}`;
};

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

export default function Quotation() {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [quoteNo, setQuoteNo] = useState(generateNo);
  const [quoteDate, setQuoteDate] = useState(localDate());
  const [validUntil, setValidUntil] = useState(addDays(localDate(), 7));

  const [custId, setCustId] = useState("");
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddress, setCustAddress] = useState("");

  const [items, setItems] = useState([{ id: uid(), productId: "", name: "", qty: "1", unit: "", rate: "", note: "", hsn: "", showNote: false }]);
  const [quickAdd, setQuickAdd] = useState("");
  const [discountPct, setDiscountPct] = useState("0");
  const [taxPct, setTaxPct] = useState("0");
  const [notes, setNotes] = useState("This quotation is valid for the period mentioned above. Prices and availability may change without notice.");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [p, c] = await Promise.all([api.products(), api.customers()]);
        if (!active) return;
        setProducts(p || []);
        setCustomers(c || []);
        setError(null);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: String(p.id),
        label: `${p.name}${Number(p.selling_price) > 0 ? ` · ${fmtMoney(p.selling_price)}` : ""}`
      })),
    [products]
  );

  const findProduct = (id) => products.find((p) => String(p.id) === String(id));

  const totals = useMemo(() => {
    const subtotal = items.reduce((a, it) => a + (Number(it.rate) || 0) * (Number(it.qty) || 0), 0);
    const dPct = Number(discountPct) || 0;
    const tPct = Number(taxPct) || 0;
    const discountAmt = (subtotal * dPct) / 100;
    const taxable = subtotal - discountAmt;
    const taxAmt = (taxable * tPct) / 100;
    return { subtotal, discountAmt, taxable, taxAmt, total: taxable + taxAmt, dPct, tPct };
  }, [items, discountPct, taxPct]);

  const updateItem = (id, field, value) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));

  const pickProduct = (id, productId) => {
    const prod = findProduct(productId);
    if (!prod) {
      updateItem(id, "productId", productId);
      return;
    }
    const rate = String(Math.max((Number(prod.selling_price) || 0) - (Number(prod.discount) || 0), 0));
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              productId: String(prod.id),
              name: prod.name,
              rate,
              unit: prod.unit_name || "",
              hsn: prod.hsn_code || ""
            }
          : it
      )
    );
  };

  const selectCustomer = (id) => {
    const cust = customers.find((c) => String(c.id) === String(id));
    setCustId(id);
    setCustName(cust ? cust.name : "");
    setCustPhone(cust ? cust.phone || "" : "");
    setCustAddress(cust ? cust.address || "" : "");
  };

  const addItem = () =>
    setItems((prev) => [...prev, { id: uid(), productId: "", name: "", qty: "1", unit: "", rate: "", note: "", hsn: "", showNote: false }]);

  const quickAddProduct = (productId) => {
    if (productId) {
      const prod = findProduct(productId);
      setItems((prev) => [
        ...prev,
        {
          id: uid(),
          productId: String(productId),
          name: prod ? prod.name : "",
          qty: "1",
          unit: prod ? prod.unit_name || "" : "",
          rate: prod ? String(Math.max((Number(prod.selling_price) || 0) - (Number(prod.discount) || 0), 0)) : "",
          note: "",
          hsn: prod ? prod.hsn_code || "" : "",
          showNote: false
        }
      ]);
    }
    setQuickAdd("");
  };

  const removeItem = (id) => setItems((prev) => prev.filter((it) => it.id !== id));

  const toggleNote = (id) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, showNote: !it.showNote } : it)));

  const quoteDocs = useMemo(() => {
    const filledItems = items
      .filter((it) => it.name.trim() && Number(it.qty) > 0 && Number(it.rate) > 0)
      .map((it) => ({
        name: it.name.trim(),
        qty: Number(it.qty) || 0,
        unit: it.unit.trim(),
        rate: Number(it.rate) || 0,
        hsn: it.hsn.trim(),
        note: it.note.trim()
      }));
    return {
      number: quoteNo.trim(),
      date: quoteDate,
      validUntil,
      customerName: custName.trim(),
      customerPhone: custPhone.trim(),
      customerAddress: custAddress.trim(),
      items: filledItems,
      discountPct: totals.dPct,
      taxPct: totals.tPct,
      notes: notes.trim(),
      subtotal: totals.subtotal,
      discountAmt: totals.discountAmt,
      taxAmt: totals.taxAmt,
      total: totals.total
    };
  }, [items, quoteNo, quoteDate, validUntil, custName, custPhone, custAddress, totals, notes]);

  const doPrint = () => {
    printQuotationA4(quoteDocs, getStoreInfo());
  };

  const doWhatsApp = () => {
    if (!custPhone.trim()) {
      setToast("Add a client phone number to send on WhatsApp");
      return;
    }
    const text = buildQuotationWhatsAppText(getStoreInfo(), quoteDocs);
    copyToClipboard(text);
    openWhatsApp(text, custPhone);
    setToast("Copied to clipboard — paste into the opened WhatsApp chat");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Quotation Bill Maker</p>
            <p className="text-xs text-slate-500">Build a quotation for a client, preview, print or send on WhatsApp</p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button variant="soft" onClick={doPrint} className="flex-1 sm:flex-none">
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button onClick={doWhatsApp} className="flex-1 sm:flex-none">
            <Send className="h-4 w-4" /> Send WhatsApp
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-5 text-sm text-rose-600">
          Failed to load products/customers: {error}
          <button className="ml-2 font-semibold underline" onClick={() => window.location.reload()}>
            Retry
          </button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* ── LEFT: builder ─────────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Quotation details</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Quotation no.">
                <Input value={quoteNo} onChange={(e) => setQuoteNo(e.target.value)} />
              </Field>
              <Field label="Date">
                <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
              </Field>
              <Field label="Valid until">
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Client</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Select existing customer">
                  <SearchableSelect
                    value={custId}
                    onChange={(e) => selectCustomer(e.target.value)}
                    options={[{ value: "", label: "New / walk-in client (type below)" }, ...customers.map((c) => ({ value: String(c.id), label: c.name }))]}
                    placeholder="Choose a customer…"
                    searchPlaceholder="Search customers…"
                  />
                </Field>
              </div>
              <Field label="Name">
                <Input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Client name" />
              </Field>
              <Field label="Phone">
                <Input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} placeholder="Phone for WhatsApp" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address">
                  <Input value={custAddress} onChange={(e) => setCustAddress(e.target.value)} placeholder="Address" />
                </Field>
              </div>
            </div>
          </Card>

          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Items
                {items.length > 0 && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">{items.length}</span>}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="soft" onClick={addItem}>
                  <Plus className="h-4 w-4" /> Add row
                </Button>
              </div>
            </div>

            <div className="border-b border-slate-100 p-3">
              <Field label="Quick add — search a product to bill instantly (qty 1)">
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
              <div className="hidden min-w-0 grid-cols-12 gap-2 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 sm:grid">
                <div className="col-span-5">Item</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-1">Unit</div>
                <div className="col-span-2">Rate</div>
                <div className="col-span-2 text-right">Amount</div>
              </div>
              {items.map((it) => {
                const amt = (Number(it.rate) || 0) * (Number(it.qty) || 0);
                return (
                  <div key={it.id} className="grid grid-cols-2 items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2 sm:grid-cols-12 sm:gap-2">
                    <div className="col-span-2 space-y-1.5 sm:col-span-5">
                      <SearchableSelect
                        value={it.productId}
                        onChange={(e) => pickProduct(it.id, e.target.value)}
                        options={[{ value: "", label: "Custom item (type below)" }, ...productOptions]}
                        placeholder="Choose product…"
                        searchPlaceholder="Search products…"
                      />
                      <Input value={it.name} onChange={(e) => updateItem(it.id, "name", e.target.value)} placeholder="Item / description" className="!py-2 text-xs" />
                    </div>
                    <div className="sm:col-span-2">
                      <Input type="number" min="0" value={it.qty} onChange={(e) => updateItem(it.id, "qty", e.target.value)} className="!py-2 text-xs" />
                    </div>
                    <div className="sm:col-span-1">
                      <Input value={it.unit} onChange={(e) => updateItem(it.id, "unit", e.target.value)} placeholder="kg" className="!py-2 text-xs" />
                    </div>
                    <div className="col-span-2 sm:col-span-2">
                      <Input type="number" min="0" value={it.rate} onChange={(e) => updateItem(it.id, "rate", e.target.value)} placeholder="Rate" className="!py-2 text-xs" />
                    </div>
                    <div className="col-span-2 flex items-center justify-between gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 sm:col-span-2">
                      <span className="text-xs font-bold text-slate-800">{amt > 0 ? fmtMoney(amt) : "—"}</span>
                      <span className="flex items-center gap-0.5">
                        <button
                          onClick={() => toggleNote(it.id)}
                          aria-label="Add note"
                          className={`rounded-md p-1 transition ${it.showNote ? "bg-amber-100 text-amber-600" : "text-slate-400 hover:bg-slate-100"}`}
                        >
                          <StickyNote className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => removeItem(it.id)}
                          aria-label="Remove item"
                          className="rounded-md p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    </div>
                    {it.showNote && (
                      <div className="col-span-2 sm:col-span-12">
                        <Input value={it.note} onChange={(e) => updateItem(it.id, "note", e.target.value)} placeholder="Note / description / HSN / warranty…" className="!py-2 text-xs" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Pricing & terms</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Discount %">
                <Input type="number" min="0" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
              </Field>
              <Field label="GST / Tax %">
                <Input type="number" min="0" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes / terms">
                  <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>
            </div>
          </Card>
        </div>

        {/* ── RIGHT: live preview ───────────────────────────────── */}
        <div className="xl:sticky xl:top-4 xl:self-start">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Live preview — A4</p>
              {quoteDocs.items.length === 0 && <span className="text-[11px] text-slate-400">no items yet</span>}
            </div>
            <div className="bg-slate-100 p-4 sm:p-6">
              <div className="mx-auto max-w-md rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <div className="accent-banner h-1.5 rounded-t-xl bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-500" />
                <div className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-extrabold text-slate-900">{getStoreInfo().name}</p>
                      <p className="text-[11px] leading-snug text-slate-400">
                        {getStoreInfo().address && <span>{getStoreInfo().address}</span>}
                        {getStoreInfo().phone && <span>{"\n"}Ph: {getStoreInfo().phone}</span>}
                        {getStoreInfo().taxNo && <span>{"\n"}Tax: {getStoreInfo().taxNo}</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">Quotation</p>
                      <p className="mt-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-sm font-bold text-slate-900">{quoteNo || "QT-…"}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {quoteDate && <strong>{fmtDate(quoteDate)}</strong>}
                        {validUntil && <> · valid till {fmtDate(validUntil)}</>}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Prepared for</p>
                    <p className="text-sm font-bold text-slate-900">{custName.trim() || "Client"}</p>
                    {(custPhone.trim() || custAddress.trim()) && (
                      <p className="text-[11px] text-slate-500">
                        {custPhone.trim() && <>Ph: {custPhone.trim()} </>}
                        {custAddress.trim()}
                      </p>
                    )}
                  </div>

                  {quoteDocs.items.length === 0 ? (
                    <div className="space-y-2 py-6 text-center">
                      <FileText className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="text-xs text-slate-400">Add items to see the quotation preview.</p>
                    </div>
                  ) : (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="rounded-lg bg-indigo-600 text-white">
                          <th className="rounded-l-lg px-2 py-1.5 text-left font-semibold">Item</th>
                          <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                          <th className="px-2 py-1.5 text-right font-semibold">Rate</th>
                          <th className="rounded-r-lg px-2 py-1.5 text-right font-semibold">Amt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quoteDocs.items.map((it, i) => (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="px-2 py-1.5 font-semibold text-slate-800">
                              {it.name}
                              {it.hsn && <span className="block text-[9px] text-slate-400">HSN {it.hsn}</span>}
                              {it.note && <span className="block text-[9px] text-slate-400">{it.note}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-600">
                              {it.qty}
                              {it.unit ? ` ${it.unit}` : ""}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{fmtMoney(it.rate)}</td>
                            <td className="px-2 py-1.5 text-right font-bold text-slate-800">{fmtMoney(it.rate * it.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {quoteDocs.items.length > 0 && (
                    <div className="ml-auto w-56 space-y-1 text-[11px]">
                      <div className="flex justify-between text-slate-500">
                        <span>Subtotal</span>
                        <span className="font-semibold">{fmtMoney(quoteDocs.subtotal)}</span>
                      </div>
                      {quoteDocs.discountAmt > 0 && (
                        <div className="flex justify-between text-rose-600">
                          <span>Discount ({quoteDocs.dPct}%)</span>
                          <span className="font-semibold">− {fmtMoney(quoteDocs.discountAmt)}</span>
                        </div>
                      )}
                      {quoteDocs.taxAmt > 0 && (
                        <div className="flex justify-between text-indigo-600">
                          <span>GST ({quoteDocs.tPct}%)</span>
                          <span className="font-semibold">+ {fmtMoney(quoteDocs.taxAmt)}</span>
                        </div>
                      )}
                      <div className="flex justify-between rounded-lg bg-indigo-600 px-2 py-1 text-white">
                        <span className="font-bold">Total</span>
                        <span className="font-bold">{fmtMoney(quoteDocs.total)}</span>
                      </div>
                    </div>
                  )}

                  {quoteDocs.notes && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-800">
                      <span className="font-bold uppercase tracking-wide">Notes: </span>
                      {quoteDocs.notes}
                    </div>
                  )}

                  <div className="flex items-end justify-between pt-2 text-[10px] text-slate-400">
                    <div className="w-24 text-center">
                      <div className="border-t border-slate-400 pt-0.5">Customer signature</div>
                    </div>
                    <div className="w-24 text-center">
                      <div className="border-t border-slate-400 pt-0.5">For {getStoreInfo().name}</div>
                      Authorized signatory
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Prints directly on A4. WhatsApp message is copied so you can paste it if the prefill is missing.
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}