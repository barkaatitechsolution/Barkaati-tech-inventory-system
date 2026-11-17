import { useEffect, useMemo, useState } from "react";
import { Search, Tags, Wallet } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtMoney } from "../lib/format.js";
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, showToast } from "../components/ui.jsx";

export default function Prices() {
  const { version, bump } = useApp();
  const products = useAsync(() => api.products({ limit: 1000 }), [version]);
  const categories = useAsync(() => api.customerCategories(), [version]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  const rows = products.data || [];
  const cats = categories.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => [p.name, p.barcode, (p.category || p.category_name)].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      try {
        const existing = await api.customerPrices(selected.id);
        const map = {};
        for (const row of existing) map[row.customer_category_id] = String(row.price ?? "");
        setValues(map);
      } catch {
        setValues({});
      }
    })();
  }, [selected]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.updateCustomerPrices(selected.id, values);
      showToast("Prices saved");
      setSelected(null);
      bump();
    } catch (e) {
      showToast(e?.message || "Could not save prices", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="Customer prices" subtitle="Special prices by customer category" />

      <div className="space-y-3 px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" />
        </div>

        {products.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((p) => (
              <Card key={p.id} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Tags className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                  <p className="truncate text-[11px] text-slate-400">{(p.category || p.category_name) || "Uncategorised"} · Default {fmtMoney(p.selling_price)}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setSelected(p)}>Set</Button>
              </Card>
            ))}
          </div>
        ) : (
          <Empty icon={Tags} title="No products" description="Add products before setting category prices." />
        )}
      </div>

      <Modal open={!!selected} title={selected?.name || "Prices"} onClose={() => setSelected(null)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save prices</Button>}>
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <p className="text-slate-500">Default selling price</p>
            <p className="text-lg font-bold text-slate-900">{fmtMoney(selected?.selling_price)}</p>
          </div>
          {cats.length ? cats.map((c) => (
            <Field key={c.id} label={`${c.name} price (Rs)`} hint="Leave blank to use the default price">
              <Input value={values[c.id] ?? ""} inputMode="decimal"
                onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))} />
            </Field>
          )) : <p className="text-sm text-slate-500">Add customer categories in Settings first.</p>}
        </div>
      </Modal>
    </div>
  );
}
