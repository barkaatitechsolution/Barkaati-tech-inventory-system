import { useEffect, useMemo, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { Search, CircleDollarSign, Package, Save, CheckCircle2, Tag, TrendingUp } from "lucide-react";
import { api } from "../api.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import { Field, Input, Button } from "../components/Field.jsx";
import Pagination from "../components/Pagination.jsx";
import { fmtMoney } from "../lib/format.js";

const PAGE_SIZE = 20;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const finalPrice = (p) => {
  const base = Math.max((Number(p.selling_price) || 0) - (Number(p.discount) || 0), 0);
  return round2(base + (base * (Number(p.tax) || 0)) / 100);
};
const savingPerUnit = (p) => round2(Math.max(0, (Number(p.market_price) || 0) - finalPrice(p)));
const purchaseCost = (p) => {
  const c = Number(p.purchase_cost);
  return Number.isFinite(c) && c > 0 ? c : Number(p.purchase_price) || 0;
};
const hasPurchaseTax = (p) => round2(purchaseCost(p)) !== round2(Number(p.purchase_price) || 0);
const marginPerUnit = (p) => round2(finalPrice(p) - purchaseCost(p));

export default function Prices() {
  const [rows, setRows] = useState([]);
  const [custCats, setCustCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const [savedIds, setSavedIds] = useState({});
  const [catEditor, setCatEditor] = useState(null);
  const [catDraft, setCatDraft] = useState({});
  const [savingCat, setSavingCat] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [p, cc] = await Promise.all([api.productOptions(), api.customerCategories()]);
      setRows(p);
      setCustCats(cc || []);
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

  useEffect(() => {
    if (Object.keys(savedIds).length === 0) return;
    const t = setTimeout(() => setSavedIds({}), 1600);
    return () => clearTimeout(t);
  }, [savedIds]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((p) =>
      !q ||
      [p.name, p.sku, p.category]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [rows, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const stats = useMemo(() => {
    const count = rows.length;
    const noSelling = rows.filter((p) => Number(p.selling_price) <= 0).length;
    const noMarket = rows.filter((p) => Number(p.market_price) <= 0).length;
    const savings = rows.reduce((a, p) => a + savingPerUnit(p) * (Number(p.stock) || 0), 0);
    const marginStock = rows.reduce((a, p) => a + marginPerUnit(p) * (Number(p.stock) || 0), 0);
    return { count, noSelling, noMarket, savings, marginStock };
  }, [rows]);

  const draftFor = (p) => {
    const d = drafts[p.id];
    return {
      selling_price: d && d.selling_price !== undefined ? d.selling_price : p.selling_price ?? "",
      market_price: d && d.market_price !== undefined ? d.market_price : p.market_price ?? ""
    };
  };

  const setDraft = (id, field, val) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: val } }));
  };

  const isDirty = (p) => {
    const d = drafts[p.id];
    if (!d) return false;
    return (
      (d.selling_price !== undefined && String(d.selling_price) !== String(p.selling_price ?? "")) ||
      (d.market_price !== undefined && String(d.market_price) !== String(p.market_price ?? ""))
    );
  };

  const saveRow = async (p) => {
    const d = drafts[p.id] || {};
    setSavingId(p.id);
    try {
      await api.updateProductPrices(p.id, {
        selling_price: Number(d.selling_price ?? p.selling_price) || 0,
        market_price: Number(d.market_price ?? p.market_price) || 0
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      setSavedIds((prev) => ({ ...prev, [p.id]: true }));
      setToast("Prices updated");
      await load();
    } catch (err) {
      setToast(`Failed: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const openCatEditor = (p) => {
    setCatEditor(p);
    const seed = {};
    (Array.isArray(p.category_prices) ? p.category_prices : []).forEach((cp) => {
      seed[String(cp.category_id)] = cp.selling_price ?? "";
    });
    setCatDraft(seed);
  };

  const saveCatPrices = async () => {
    if (!catEditor) return;
    setSavingCat(true);
    try {
      await api.customerPrices(catEditor.id, catDraft);
      setCatEditor(null);
      setToast("Category prices updated");
      await load();
    } catch (err) {
      setToast(`Failed: ${err.message}`);
    } finally {
      setSavingCat(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Products", value: stats.count, icon: Package, color: "text-indigo-600" },
          { label: "No Selling Price", value: stats.noSelling, icon: CircleDollarSign, color: "text-rose-500" },
          { label: "No Market Price", value: stats.noMarket, icon: CircleDollarSign, color: "text-amber-600" },
          { label: "You Save Customers", value: fmtMoney(stats.savings), icon: CheckCircle2, color: "text-emerald-600" },
          { label: "Margin on Stock", value: fmtMoney(stats.marginStock), icon: TrendingUp, color: "text-sky-600" }
        ].map((s) => (
          <Card key={s.label} className="!p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{s.label}</p>
                <p className={`mt-1 text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
              <s.icon className={`h-5 w-5 shrink-0 ${s.color}`} />
            </div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
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
          <p className="p-5 text-sm text-rose-600">Failed to load products: {error}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <CircleDollarSign className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold text-slate-900">No products found</p>
            <p className="mt-1 text-sm text-slate-500">Add products first to manage their prices.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3 sm:px-5">Product</th>
                    <th className="hidden px-3 py-3 text-right sm:table-cell">Purchase</th>
                    <th className="px-3 py-3 text-right">Selling</th>
                    <th className="px-3 py-3 text-right">Market</th>
                    <th className="hidden px-3 py-3 text-right sm:table-cell">Save / Unit</th>
                    <th className="hidden px-3 py-3 text-right sm:table-cell">Margin / Unit</th>
                    <th className="px-3 py-3 text-right sm:px-5">—</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => {
                    const d = draftFor(p);
                    const dirty = isDirty(p);
                    const saving = savingPerUnit({ ...p, selling_price: Number(d.selling_price) || 0 });
                    const margin = marginPerUnit({ ...p, selling_price: Number(d.selling_price) || 0 });
                    return (
                      <tr key={p.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                        <td className="px-3 py-3 sm:px-5">
                          <p className="font-semibold text-slate-800">{p.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {[p.sku, p.category].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </td>
                        <td className="hidden px-3 py-3 text-right text-slate-500 sm:table-cell">
                          <p>{fmtMoney(purchaseCost(p))}</p>
                          {hasPurchaseTax(p) && <p className="text-[10px] text-slate-400">incl. tax</p>}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={d.selling_price}
                            onChange={(e) => setDraft(p.id, "selling_price", e.target.value)}
                            className="w-24 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-right text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                          />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={d.market_price}
                            onChange={(e) => setDraft(p.id, "market_price", e.target.value)}
                            className="w-24 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-right text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                          />
                        </td>
                        <td className="hidden px-3 py-3 text-right sm:table-cell">
                          {saving > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              {fmtMoney(saving)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="hidden px-3 py-3 text-right sm:table-cell">
                          {margin > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                              {fmtMoney(margin)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right sm:px-5">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="soft"
                              className="!px-2.5 !py-1.5 text-xs"
                              onClick={() => openCatEditor(p)}
                              title="Customer category prices"
                              aria-label="Edit customer category prices"
                            >
                              <Tag className="h-3.5 w-3.5" />
                            </Button>
                            {savedIds[p.id] ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                              </span>
                            ) : (
                              <Button
                                type="button"
                                variant="soft"
                                className="!px-3 !py-1.5 text-xs"
                                disabled={!dirty || savingId === p.id}
                                onClick={() => saveRow(p)}
                              >
                                <Save className="h-3.5 w-3.5" />
                                {savingId === p.id ? "Saving…" : "Save"}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 sm:hidden">
              {pageRows.map((p) => {
                const d = draftFor(p);
                const dirty = isDirty(p);
                const saving = savingPerUnit({ ...p, selling_price: Number(d.selling_price) || 0 });
                const margin = marginPerUnit({ ...p, selling_price: Number(d.selling_price) || 0 });
                return (
                  <div key={p.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {[p.sku, p.category].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <Button
                          type="button"
                          variant="soft"
                          className="mb-1.5 w-full !px-2.5 !py-1.5 text-xs"
                          onClick={() => openCatEditor(p)}
                          title="Customer category prices"
                          aria-label="Edit customer category prices"
                        >
                          <Tag className="h-3.5 w-3.5" /> Prices
                        </Button>
                        {savedIds[p.id] ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                          </span>
                        ) : (
                          <Button
                            type="button"
                            variant="soft"
                            className="!px-3 !py-1.5 text-xs"
                            disabled={!dirty || savingId === p.id}
                            onClick={() => saveRow(p)}
                          >
                            <Save className="h-3.5 w-3.5" />
                            {savingId === p.id ? "Saving…" : "Save"}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <p className="mb-1 text-[11px] text-slate-400">Selling price</p>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={d.selling_price}
                          onChange={(e) => setDraft(p.id, "selling_price", e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-right text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        />
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] text-slate-400">Market price</p>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={d.market_price}
                          onChange={(e) => setDraft(p.id, "market_price", e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-right text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        />
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Purchase {fmtMoney(purchaseCost(p))}
                      {hasPurchaseTax(p) ? <span> incl. tax</span> : null}
                      {saving > 0 ? (
                        <span className="font-semibold text-emerald-600"> · You save {fmtMoney(saving)}/unit</span>
                      ) : null}
                    </p>
                    {margin > 0 && (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Margin{" "}
                        <span className="font-semibold text-sky-700">{fmtMoney(margin)}</span>/unit
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!loading && !error && filtered.length > 0 && (
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        )}
      </Card>

      <Modal
        open={!!catEditor}
        onClose={() => setCatEditor(null)}
        title={catEditor ? `Category prices — ${catEditor.name}` : "Category prices"}
        subtitle="Custom selling price charged to each customer category. Leave empty to use the product's default selling price."
      >
        {custCats.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">
            No customer categories yet — add categories in the Customers page first.
          </p>
        ) : (
          <div className="space-y-4">
            {custCats.map((c) => (
              <Field key={c.id} label={c.name}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={catDraft[String(c.id)] ?? ""}
                  onChange={(e) => setCatDraft((prev) => ({ ...prev, [String(c.id)]: e.target.value }))}
                  placeholder={catEditor ? fmtMoney(finalPrice(catEditor)) : "0.00"}
                />
              </Field>
            ))}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => setCatEditor(null)}>
            Cancel
          </Button>
          <Button type="button" onClick={saveCatPrices} disabled={savingCat || !catEditor}>
            {savingCat ? "Saving…" : "Save Category Prices"}
          </Button>
        </div>
      </Modal>

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}