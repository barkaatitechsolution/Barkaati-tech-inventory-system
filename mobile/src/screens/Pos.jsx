import { useMemo, useState } from "react";
import {
  Minus,
  Plus,
  Printer,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  X
} from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtMoney } from "../lib/format.js";
import { printReceipt } from "../lib/printer.js";
import { scanBarcode } from "../lib/scanner.js";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  cx,
  showToast
} from "../components/ui.jsx";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "credit", label: "Credit (pay later)" }
];

export default function Pos() {
  const { store, version, bump } = useApp();
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState([]);
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState("cash");
  const [paid, setPaid] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [activeId, setActiveId] = useState(null);

  const products = useAsync(() => api.products({ q: query, limit: 60 }), [query, version]);
  const customers = useAsync(() => api.customers(), [version]);
  const units = useAsync(() => api.measuringUnits(), [version]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const line of cart) {
      const lineTotal = Number(line.unit_price) * Number(line.qty);
      subtotal += lineTotal;
      tax += (lineTotal * (Number(line.tax) || 0)) / 100;
    }
    const disc = Number(discount) || 0;
    const total = Math.max(0, Math.round((subtotal + tax - disc) * 100) / 100);
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total
    };
  }, [cart, discount]);

  const count = cart.reduce((n, l) => n + Number(l.qty), 0);

  const addProduct = (p) => {
    setActiveId(p.id);
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product_id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          qty: next[idx].qty + 1,
          _qtyTouched: true
        };
        return next;
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          qty: 1,
          unit_price: Number(p.selling_price) || 0,
          tax: Number(p.tax) || 0,
          stock: Number(p.stock) || 0,
          unit: p.unit || "pcs",
          unit_id: p.unit_id || null,
          purchase_price: Number(p.purchase_price) || 0,
          _qtyTouched: false,
          _weightScanned: false
        }
      ];
    });
    showToast(`${p.name} added`, "info");
  };

  const applyWeightScan = async (code) => {
    const row = await api.weightBarcodeByCode(code);
    if (!row) {
      showToast(`No weight barcode for ${code}`, "error");
      return;
    }
    if (!cart.length) {
      showToast("Add an item to the cart first, then scan the weight.", "error");
      return;
    }
    const grams = Number(row.weight_g) || 0;
    const activeIdx = activeId ? cart.findIndex((l) => String(l.product_id) === String(activeId)) : -1;
    const targetIdx = activeIdx >= 0 ? activeIdx : cart.length - 1;
    const line = cart[targetIdx];
    const unit =
      (units.data || []).find((u) => String(u.id) === String(line.unit_id)) ||
      (units.data || []).find(
        (u) => String(u.short_name || "").toLowerCase() === String(line.unit || "").toLowerCase()
      );
    const category = String(unit?.category || "").toLowerCase();
    const factor = Number(unit?.conversion_factor);
    const kilograms = grams / 1000;
    const scannedQty =
      category === "weight" && factor > 0
        ? Math.round((kilograms / factor) * 1000000) / 1000000
        : Math.round(kilograms * 1000000) / 1000000;
    if (!(scannedQty > 0)) {
      showToast("That weight cannot be applied to this item", "error");
      return;
    }
    const currentQty = Number(line.qty) || 0;
    const baseQty = line._weightScanned || line._qtyTouched ? currentQty : 0;
    const nextQty = Math.round((baseQty + scannedQty) * 1000000) / 1000000;
    setActiveId(line.product_id);
    setCart((prev) =>
      prev.map((l, i) =>
        i === targetIdx ? { ...l, qty: nextQty, _qtyTouched: true, _weightScanned: true } : l
      )
    );
    showToast(`${row.weight_label} added to ${line.name}`, "info");
  };

  const scan = async () => {
    setScanning(true);
    try {
      const code = await scanBarcode();
      if (String(code || "").trim().toUpperCase().startsWith("WT:")) {
        await applyWeightScan(code);
        return;
      }
      const p = await api.productByBarcode(code);
      if (p) {
        addProduct(p);
      } else {
        setQuery(code);
        showToast(`No product with barcode ${code}`, "error");
      }
    } catch (e) {
      showToast(e?.message || "Scan failed", "error");
    } finally {
      setScanning(false);
    }
  };

  const scanCustomerCard = async () => {
    setScanning(true);
    try {
      const code = await scanBarcode();
      const customer = await api.customerByBarcode(code);
      if (!customer) {
        showToast(`No customer with card ${code}`, "error");
        return;
      }
      setCustomerId(customer.id);
      setCustomerName("");
      setCustomerPhone("");
      showToast(`${customer.name} selected`, "info");
    } catch (e) {
      showToast(e?.message || "Customer card scan failed", "error");
    } finally {
      setScanning(false);
    }
  };

  const setQty = (id, qty) => {
    setActiveId(id);
    setCart((prev) =>
      prev
        .map((l) =>
          l.product_id === id
            ? { ...l, qty: Math.max(0, Number(qty) || 0), _qtyTouched: true, _weightScanned: false }
            : l
        )
        .filter((l) => l.qty > 0)
    );
  };

  const setPrice = (id, price) => {
    setActiveId(id);
    setCart((prev) => prev.map((l) => (l.product_id === id ? { ...l, unit_price: Number(price) || 0 } : l)));
  };

  const reset = () => {
    setCart([]);
    setActiveId(null);
    setCustomerId("");
    setCustomerName("");
    setCustomerPhone("");
    setDiscount("");
    setMethod("cash");
    setPaid("");
    setNote("");
    setDone(null);
    setOpen(false);
  };

  const checkout = async () => {
    if (!cart.length) return;
    setSaving(true);
    try {
      const selected = customers.data?.find((c) => String(c.id) === String(customerId));
      const sale = await api.createSale({
        customer_id: customerId || null,
        customer_name: selected?.name || customerName,
        customer_phone: selected?.phone || customerPhone,
        items: cart.map((l) => ({
          product_id: l.product_id,
          qty: l.qty,
          unit_price: l.unit_price,
          tax: l.tax,
          unit_name: l.unit
        })),
        discount: Number(discount) || 0,
        total: totals.total,
        paid: paid === "" ? (method === "credit" ? 0 : totals.total) : Number(paid) || 0,
        payment_method: method,
        status: method === "credit" ? "unpaid" : undefined,
        note
      });
      setDone(sale);
      bump();
      setOpen(false);
    } catch (e) {
      showToast(e?.message || "Could not save the bill", "error");
    } finally {
      setSaving(false);
    }
  };

  const print = async () => {
    if (!done) return;
    try {
      await printReceipt(done, done.items, store || {});
      showToast("Sent to printer");
    } catch (e) {
      showToast(e?.message || "Printing failed", "error");
    }
  };

  return (
    <div className="flex min-h-full flex-col pb-24">
      <PageHeader
        title="New sale"
        subtitle={`${count} item${count === 1 ? "" : "s"} in cart`}
        right={
          <IconButton onClick={scan} className="bg-white shadow-sm" aria-label="Scan barcode">
            {scanning ? <Spinner /> : <ScanLine className="h-5 w-5" />}
          </IconButton>
        }
      />

      <div className="px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, SKU or barcode"
            className="pl-9"
            inputMode="search"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-2.5 rounded-full p-1.5 text-slate-400"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 px-4 pt-3">
        {products.loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="text-brand-600" />
          </div>
        ) : products.error ? (
          <Card className="border border-red-100 bg-red-50">
            <p className="text-sm text-red-700">{products.error}</p>
          </Card>
        ) : products.data?.length ? (
          <div className="grid grid-cols-2 gap-2.5">
            {products.data.map((p) => {
              const inCart = cart.find((l) => l.product_id === p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p)}
                  className={cx(
                    "relative rounded-2xl bg-white p-3 text-left shadow-sm active:bg-slate-50",
                    inCart && "ring-2 ring-brand-400"
                  )}
                >
                  {inCart ? (
                    <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1 text-[11px] font-bold text-white">
                      {inCart.qty}
                    </span>
                  ) : null}
                  <p className="line-clamp-2 min-h-[2.5em] pr-4 text-sm font-semibold text-slate-800">
                    {p.name}
                  </p>
                  <p className="mt-1 text-base font-bold text-brand-700">{fmtMoney(p.selling_price)}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">{p.unit || "pcs"}</span>
                    <Badge tone={Number(p.stock) > 0 ? "green" : "red"}>
                      {Number(p.stock) > 0 ? `${p.stock} left` : "out"}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <Empty
            icon={ShoppingCart}
            title={query ? "No products found" : "No products yet"}
            description={query ? "Try another search or scan the barcode." : "Add products to start selling."}
          />
        )}
      </div>

      {cart.length ? (
        <div className="safe-bottom fixed inset-x-0 bottom-[57px] z-20 border-t border-slate-200 bg-white p-3">
          <Button className="w-full" size="lg" onClick={() => setOpen(true)}>
            <ShoppingCart className="h-4.5 w-4.5" />
            View cart · {count} item{count === 1 ? "" : "s"}
            <span className="ml-auto">{fmtMoney(totals.total)}</span>
          </Button>
        </div>
      ) : null}

      <Modal
        open={open}
        title="Cart"
        onClose={() => setOpen(false)}
        wide
        footer={
          <Button className="w-full" size="lg" loading={saving} onClick={checkout}>
            Complete sale · {fmtMoney(totals.total)}
          </Button>
        }
      >
        <div className="space-y-3">
          {cart.map((line) => (
            <div
              key={line.product_id}
              onClick={() => setActiveId(line.product_id)}
              className={`rounded-xl border p-3 ${
                String(activeId) === String(line.product_id)
                  ? "border-brand-400 bg-brand-50/50"
                  : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{line.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {line.unit} · stock {line.stock}
                  </p>
                </div>
                <IconButton
                  onClick={() => setQty(line.product_id, 0)}
                  className="h-8 w-8 text-red-500"
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setQty(line.product_id, line.qty - 1)}
                    className="flex h-9 w-9 items-center justify-center text-slate-600"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    value={line.qty}
                    onChange={(e) => setQty(line.product_id, e.target.value)}
                    inputMode="decimal"
                    className="w-12 border-x border-slate-200 py-1.5 text-center text-sm font-semibold outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setQty(line.product_id, line.qty + 1)}
                    className="flex h-9 w-9 items-center justify-center text-slate-600"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-1 items-center gap-1">
                  <span className="text-xs text-slate-400">Rs</span>
                  <input
                    value={line.unit_price}
                    onChange={(e) => setPrice(line.product_id, e.target.value)}
                    inputMode="decimal"
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-semibold outline-none"
                  />
                </div>
                <p className="w-20 text-right text-sm font-bold text-slate-900">
                  {fmtMoney(Number(line.unit_price) * Number(line.qty))}
                </p>
              </div>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Customer">
              <div className="flex items-center gap-2">
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="min-w-0 flex-1">
                  <option value="">Walk-in / new</option>
                  {(customers.data || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </option>
                  ))}
                </Select>
                <IconButton
                  onClick={scanCustomerCard}
                  disabled={scanning}
                  aria-label="Scan customer card"
                  title="Scan customer card"
                  className="bg-slate-900 text-white"
                >
                  <ScanLine className="h-4 w-4" />
                </IconButton>
              </div>
            </Field>
            <Field label="Discount (Rs)">
              <Input
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </Field>
            {!customerId ? (
              <>
                <Field label="Name">
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Optional"
                    inputMode="tel"
                  />
                </Field>
              </>
            ) : null}
            <Field label="Payment">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paid now (Rs)">
              <Input
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                inputMode="decimal"
                placeholder={String(totals.total)}
              />
            </Field>
          </div>

          <Field label="Note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional" />
          </Field>

          <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Subtotal</span>
              <span>{fmtMoney(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Tax</span>
              <span>{fmtMoney(totals.tax)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Discount</span>
              <span>-{fmtMoney(discount)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-bold text-slate-900">
              <span>Total</span>
              <span>{fmtMoney(totals.total)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={reset}
            className="mx-auto block text-xs font-medium text-red-500 underline"
          >
            Clear cart
          </button>
        </div>
      </Modal>

      <Modal
        open={!!done}
        title="Sale complete"
        onClose={reset}
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={print}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button className="flex-1" onClick={reset}>
              New sale
            </Button>
          </div>
        }
      >
        {done ? (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <ShoppingCart className="h-7 w-7" />
            </div>
            <p className="text-sm text-slate-500">Bill {done.invoice_no}</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{fmtMoney(done.total)}</p>
            <p className="mt-1 text-xs text-slate-400">
              Paid {fmtMoney(done.paid)} · {done.status}
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
