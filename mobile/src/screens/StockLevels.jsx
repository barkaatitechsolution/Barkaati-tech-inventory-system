import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Boxes, PackageMinus, Search } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtMoney } from "../lib/format.js";
import { Badge, Button, Card, Empty, Input, PageHeader, Spinner, cx } from "../components/ui.jsx";

const FILTERS = ["all", "low", "out"];

export default function StockLevels() {
  const { version } = useApp();
  const products = useAsync(() => api.products({ limit: 1000 }), [version]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const rows = products.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((p) => {
      const stock = Number(p.stock) || 0;
      const reorder = Number(p.reorder_level) || 0;
      if (filter === "out" && stock > 0) return false;
      if (filter === "low" && !(stock <= reorder && stock > 0)) return false;
      if (!q) return true;
      return [p.name, p.barcode, p.sku, (p.category || p.category_name)].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search, filter]);

  const totals = useMemo(() => {
    const low = rows.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.reorder_level)).length;
    const out = rows.filter((p) => (Number(p.stock) || 0) <= 0).length;
    const value = rows.reduce((n, p) => n + (Number(p.stock) || 0) * (Number(p.purchase_price) || 0), 0);
    return { low, out, value };
  }, [rows]);

  return (
    <div className="pb-24">
      <PageHeader title="Stock levels" subtitle={`${rows.length} products · ${fmtMoney(totals.value)} at cost`}
        right={<Link to="/stock-removal"><Button size="sm" variant="outline"><PackageMinus className="h-4 w-4" /> Remove</Button></Link>} />

      <div className="space-y-3 px-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Low stock</p>
            <p className="mt-0.5 text-lg font-bold text-amber-600">{totals.low}</p>
          </Card>
          <Card className="p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Out of stock</p>
            <p className="mt-0.5 text-lg font-bold text-red-600">{totals.out}</p>
          </Card>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" />
        </div>

        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={cx("flex-1 rounded-full px-3 py-1.5 text-xs font-semibold capitalize",
                filter === f ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm")}>
              {f}
            </button>
          ))}
        </div>

        {products.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((p) => {
              const stock = Number(p.stock) || 0;
              const reorder = Number(p.reorder_level) || 0;
              const low = stock <= reorder;
              return (
                <Card key={p.id} className="flex items-center gap-3 p-3">
                  <div className={cx("flex h-9 w-9 items-center justify-center rounded-xl", low ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500")}>
                    {low ? <AlertTriangle className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {(p.category || p.category_name) || "Uncategorised"} · Reorder at {reorder} {p.unit || "pcs"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cx("text-sm font-bold", stock <= 0 ? "text-red-600" : low ? "text-amber-600" : "text-slate-900")}>
                      {stock} {p.unit || "pcs"}
                    </p>
                    <Badge tone={stock <= 0 ? "red" : low ? "amber" : "green"}>
                      {stock <= 0 ? "out" : low ? "low" : "in stock"}
                    </Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty icon={Boxes} title="Nothing here" description="No products match this filter." />
        )}
      </div>
    </div>
  );
}
