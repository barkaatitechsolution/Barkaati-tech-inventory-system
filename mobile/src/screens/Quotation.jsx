import { useMemo, useState } from "react";
import { FileText, Plus, Printer, Send, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtMoney } from "../lib/format.js";
import { shareText } from "../lib/share.js";
import { Button, Card, Empty, Field, IconButton, Input, PageHeader, Select, Textarea, showToast } from "../components/ui.jsx";

const blankLine = () => ({ product_id: "", qty: "1", unit_price: "" });

export default function Quotation() {
  const { store } = useApp();
  const products = useAsync(() => api.productOptions(), []);
  const [customer, setCustomer] = useState({ name: "", phone: "", address: "" });
  const [lines, setLines] = useState([blankLine()]);
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("");
  const [note, setNote] = useState("");
  const [validDays, setValidDays] = useState("7");

  const options = products.data || [];
  const setLine = (idx, key, value) =>
    setLines((rows) => rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));

  const rows = useMemo(
    () =>
      lines.map((l) => {
        const product = options.find((p) => String(p.id) === String(l.product_id));
        const qty = Number(l.qty) || 0;
        const price = l.unit_price === "" ? Number(product?.selling_price) || 0 : Number(l.unit_price) || 0;
        return { ...l, product, qty, price, total: Math.round(qty * price * 100) / 100 };
      }),
    [lines, options]
  );

  const subtotal = rows.reduce((n, r) => n + r.total, 0);
  const discountValue = Number(discount) || 0;
  const taxValue = Number(tax) || 0;
  const total = Math.max(0, subtotal - discountValue + taxValue);

  const quoteNo = useMemo(() => `QT-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${String(Math.floor(Math.random() * 900) + 100)}`, []);

  const buildText = () => {
    const itemLines = rows
      .filter((r) => r.product && r.qty > 0)
      .map((r, i) => `${i + 1}. ${r.product.name} — ${r.qty} × ${fmtMoney(r.price)} = ${fmtMoney(r.total)}`)
      .join("\n");
    return [
      `*Quotation ${quoteNo}*`,
      store?.name ? `${store.name}${store.phone ? ` · ${store.phone}` : ""}` : "",
      customer.name ? `For: ${customer.name}${customer.phone ? ` (${customer.phone})` : ""}` : "",
      "",
      itemLines || "No items yet",
      "",
      `Subtotal: ${fmtMoney(subtotal)}`,
      discountValue ? `Discount: -${fmtMoney(discountValue)}` : "",
      taxValue ? `Tax: ${fmtMoney(taxValue)}` : "",
      `*Total: ${fmtMoney(total)}*`,
      `Valid for ${validDays || 0} day${Number(validDays) === 1 ? "" : "s"}.`,
      note ? `\n${note}` : ""
    ].filter(Boolean).join("\n");
  };

  const share = async () => {
    if (!rows.some((r) => r.product && r.qty > 0)) return showToast("Add at least one item", "error");
    await shareText({ title: `Quotation ${quoteNo}`, text: buildText() });
  };

  const print = () => {
    if (!rows.some((r) => r.product && r.qty > 0)) return showToast("Add at least one item", "error");
    window.print();
  };

  return (
    <div className="pb-24">
      <PageHeader title="Quotation" subtitle={`Draft ${quoteNo}`} right={<Button size="sm" onClick={share}><Send className="h-4 w-4" /> Share</Button>} />

      <div className="space-y-3 px-4">
        <Card className="space-y-3 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Customer</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name"><Input value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} /></Field>
            <Field label="Phone"><Input value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} inputMode="tel" /></Field>
          </div>
          <Field label="Address"><Input value={customer.address} onChange={(e) => setCustomer((c) => ({ ...c, address: e.target.value }))} /></Field>
        </Card>

        <Card className="space-y-3 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Items</p>
            <Button size="sm" variant="ghost" onClick={() => setLines((r) => [...r, blankLine()])}><Plus className="h-3.5 w-3.5" /> Add</Button>
          </div>
          {lines.map((line, idx) => (
            <div key={idx} className="space-y-2 rounded-xl bg-slate-50 p-2">
              <Select value={line.product_id} onChange={(e) => {
                const product = options.find((p) => String(p.id) === e.target.value);
                setLines((rows) => rows.map((r, i) => i === idx ? { ...r, product_id: e.target.value, unit_price: product ? String(product.selling_price ?? "") : "" } : r));
              }}>
                <option value="">Choose a product</option>
                {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <div className="flex items-center gap-2">
                <Input value={line.qty} onChange={(e) => setLine(idx, "qty", e.target.value)} inputMode="decimal" placeholder="Qty" className="w-20" />
                <Input value={line.unit_price} onChange={(e) => setLine(idx, "unit_price", e.target.value)} inputMode="decimal" placeholder="Price" />
                <p className="w-20 shrink-0 text-right text-xs font-bold text-slate-700">{fmtMoney(rows[idx]?.total)}</p>
                <IconButton className="h-8 w-8 text-red-500" aria-label="Remove"
                  onClick={() => setLines((r) => (r.length > 1 ? r.filter((_, i) => i !== idx) : [blankLine()]))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </div>
          ))}
        </Card>

        <Card className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Discount (Rs)"><Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" /></Field>
            <Field label="Tax (Rs)"><Input value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Valid for (days)"><Input value={validDays} onChange={(e) => setValidDays(e.target.value)} inputMode="numeric" /></Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
          </div>
          <div className="space-y-1 border-t border-slate-100 pt-2 text-sm">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtMoney(subtotal)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Discount</span><span>-{fmtMoney(discountValue)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Tax</span><span>{fmtMoney(taxValue)}</span></div>
            <div className="flex justify-between text-base font-bold text-slate-900"><span>Total</span><span>{fmtMoney(total)}</span></div>
          </div>
        </Card>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={print}><Printer className="h-4 w-4" /> Print</Button>
          <Button className="flex-1" onClick={share}><Send className="h-4 w-4" /> Share</Button>
        </div>

        {!options.length && !products.loading ? (
          <Empty icon={FileText} title="No products" description="Add products first to build a quotation." />
        ) : null}
      </div>
    </div>
  );
}
