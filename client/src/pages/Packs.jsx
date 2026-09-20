import { useState, useEffect, useMemo } from "react";
import { Search, Package, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { api } from "../api";
import { fmtMoney, fmtDate } from "../lib/format";
import Card from "../components/Card.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Pagination from "../components/Pagination.jsx";

const PAGE_SIZE = 25;

const STATUS_META = {
  closed: { label: "Full", color: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-400" },
  open: { label: "Open", color: "bg-amber-100 text-amber-700", bar: "bg-amber-400" },
  empty: { label: "Empty", color: "bg-rose-100 text-rose-700", bar: "bg-rose-400" }
};

export default function Packs() {
  const [packs, setPacks] = useState([]);
  const [stats, setStats] = useState({ total_packs: 0, open_packs: 0, empty_packs: 0 });
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [p, pr, s] = await Promise.all([api.productPacks(), api.products(), api.suppliers()]);
      setPacks(p.packs || []);
      setStats(p.stats || { total_packs: 0, open_packs: 0, empty_packs: 0 });
      setProducts(pr);
      setSuppliers(s);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const productMap = useMemo(() => {
    const m = {};
    products.forEach((p) => { m[p.id] = p; });
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    return packs.filter((pk) => {
      const productName = pk.product_name || "";
      const supplierName = pk.supplier_name || "";
      if (filterProduct && String(pk.product_id) !== filterProduct) return false;
      if (filterStatus && pk.status !== filterStatus) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!productName.toLowerCase().includes(s) && !supplierName.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [packs, search, filterProduct, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, filterProduct, filterStatus]);

  const statsTotal = useMemo(() => {
    const total = Number(stats.total_packs) || 0;
    const open = Number(stats.open_packs) || 0;
    const empty = Number(stats.empty_packs) || 0;
    return { total, open, empty, closed: total - open - empty };
  }, [stats]);

  const productOptions = useMemo(() => {
    return [{ value: "", label: "All Products" }, ...products.map((p) => ({ value: String(p.id), label: p.name }))];
  }, [products]);

  const renderStat = (label, value, icon, color) => (
    <Card className="!p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-slate-100 p-2">{icon}</div>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase text-slate-400">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
        </div>
      </div>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Inventory Packs</h1>
        <p className="text-sm text-slate-500">Track individual packs, remaining quantities and status</p>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {renderStat("Total Packs", statsTotal.total, <Package className="h-5 w-5 text-slate-600" />, "text-slate-800")}
        {renderStat("Closed (Full)", statsTotal.closed, <CheckCircle className="h-5 w-5 text-emerald-600" />, "text-emerald-700")}
        {renderStat("Open (Partial)", statsTotal.open, <AlertTriangle className="h-5 w-5 text-amber-600" />, "text-amber-700")}
        {renderStat("Empty", statsTotal.empty, <XCircle className="h-5 w-5 text-rose-600" />, "text-rose-700")}
      </div>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search packs..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1 sm:w-48">
              <SearchableSelect
                value={filterProduct}
                onChange={(e) => setFilterProduct(e.target.value)}
                options={productOptions}
                placeholder="All Products"
                searchPlaceholder="Search..."
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm sm:w-44"
            >
              <option value="">All Status</option>
              <option value="closed">Closed (Full)</option>
              <option value="open">Open (Partial)</option>
              <option value="empty">Empty</option>
            </select>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="py-12 text-center">
          <Package className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-500">No packs found</p>
        </Card>
      ) : (
        <Card className="!p-0">
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-medium uppercase text-slate-400">
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5">Pack Size</th>
                  <th className="px-3 py-2.5">Remaining</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5">Purchased</th>
                  <th className="px-3 py-2.5">Opened</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((pk) => {
                  const product = productMap[pk.product_id] || {};
                  const packFull = Number(pk.pack_size);
                  const remain = Number(pk.remaining);
                  const pct = packFull > 0 ? Math.round((remain / packFull) * 100) : 0;
                  const meta = STATUS_META[pk.status] || STATUS_META.closed;

                  return (
                    <tr key={pk.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-slate-800">{pk.product_name}</p>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-700">{packFull}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full transition-all ${meta.bar}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-slate-700">
                            {remain} {product.unit || ""}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.color}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{pk.supplier_name || "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{fmtDate(pk.purchased_at)}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{pk.opened_at ? fmtDate(pk.opened_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-50 sm:hidden">
            {pageRows.map((pk) => {
              const product = productMap[pk.product_id] || {};
              const packFull = Number(pk.pack_size);
              const remain = Number(pk.remaining);
              const pct = packFull > 0 ? Math.round((remain / packFull) * 100) : 0;
              const meta = STATUS_META[pk.status] || STATUS_META.closed;

              return (
                <div key={pk.id} className="flex flex-col gap-3 px-4 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{pk.product_name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {pk.supplier_name ? `from ${pk.supplier_name}` : "No supplier"}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.color}`}>
                      {meta.label}
                    </span>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                      <span>Pack: {packFull} {product.unit || ""}</span>
                      <span className="font-semibold text-slate-700">{remain} {product.unit || ""} left · {pct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full transition-all ${meta.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>{pk.purchased_at ? `Purchased ${fmtDate(pk.purchased_at)}` : ""}</span>
                    <span>{pk.opened_at ? `Opened ${fmtDate(pk.opened_at)}` : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {!loading && !error && filtered.length > 0 && (
            <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
          )}
        </Card>
      )}
    </div>
  );
}