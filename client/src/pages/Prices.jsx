import { useEffect, useMemo, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import { Search, CircleDollarSign, Package, Save, CheckCircle2, Tag, TrendingUp, X } from "lucide-react";
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

// Margin as a percentage of what the customer actually pays, which is the only
// way two products of very different size can be compared ("10% on a ₹20 packet
// of nuts" is not the same as "10% on a ₹200 bag of rice").
//
// Null when the percentage cannot be worked out at all -- no selling price, or
// no purchase cost on file. Null is deliberately not 0: a product nobody has
// costed yet is missing information, not a product being sold at no profit, and
// treating the two the same would drop it into the "no margin" filter.
const marginPct = (p) => {
  const price = finalPrice(p);
  const cost = purchaseCost(p);
  if (price <= 0 || cost <= 0) return null;
  return round2(((price - cost) / price) * 100);
};

// Where "high" and "low" start and stop. A grocery retailer's rule of thumb sits
// well below these numbers, so anything at 25%+ is comfortably high and anything
// under 10% is eating into the cost of the goods.
const LOW_MARGIN_PCT = 10;
const HIGH_MARGIN_PCT = 25;

// Every shortcut the price list can be narrowed by. Each one is a plain test over
// a product row, so they are independent of each other and safe to combine with
// the search box.
//
// The four margin buckets are deliberately disjoint and exhaustive over the
// products whose margin is knowable: <= 0, 0-10%, 10-25%, 25%+. That means the
// margin group always accounts for every product exactly once, and the count
// beside each option in the dropdown adds up to the number on screen.
const PRICE_FILTERS = [
  { value: "selling_set", label: "Selling price set", test: (p) => finalPrice(p) > 0 },
  { value: "selling_missing", label: "Selling price not set", test: (p) => finalPrice(p) <= 0 },
  { value: "market_set", label: "Market price set", test: (p) => Number(p.market_price) > 0 },
  { value: "market_missing", label: "Market price not set", test: (p) => Number(p.market_price) <= 0 },
  {
    value: "above_market",
    label: "Priced above market",
    test: (p) => Number(p.market_price) > 0 && finalPrice(p) > Number(p.market_price)
  },
  { value: "saves_customer", label: "Saves the customer money", test: (p) => savingPerUnit(p) > 0 },
  {
    value: "high_margin",
    label: `High margin (${HIGH_MARGIN_PCT}% and above)`,
    test: (p) => {
      const m = marginPct(p);
      return m !== null && m >= HIGH_MARGIN_PCT;
    }
  },
  {
    value: "fair_margin",
    label: `Fair margin (${LOW_MARGIN_PCT}–${HIGH_MARGIN_PCT - 1}%)`,
    test: (p) => {
      const m = marginPct(p);
      return m !== null && m >= LOW_MARGIN_PCT && m < HIGH_MARGIN_PCT;
    }
  },
  {
    value: "low_margin",
    label: `Low margin (under ${LOW_MARGIN_PCT}%)`,
    test: (p) => {
      const m = marginPct(p);
      return m !== null && m > 0 && m < LOW_MARGIN_PCT;
    }
  },
  {
    value: "no_margin",
    label: "Sold at or below cost",
    test: (p) => {
      const m = marginPct(p);
      return m !== null && m <= 0;
    }
  },
  { value: "margin_unknown", label: "Margin unknown (no price or cost)", test: (p) => marginPct(p) === null }
];

const FILTER_GROUPS = [
  { label: "Selling price", values: ["selling_set", "selling_missing"] },
  { label: "Market price", values: ["market_set", "market_missing", "above_market", "saves_customer"] },
  {
    label: "Profit margin",
    values: ["high_margin", "fair_margin", "low_margin", "no_margin", "margin_unknown"]
  }
];

const FILTERS_BY_VALUE = Object.fromEntries(PRICE_FILTERS.map((f) => [f.value, f]));

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
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");

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

  // The table shows prices straight out of the inputs, including edits that have
  // not been saved yet. The filters have to judge those same numbers, otherwise
  // typing a price into a product and then filtering on "selling price set"
  // would keep hiding the row until it was saved.
  const effective = useMemo(
    () =>
      rows.map((p) => {
        const d = drafts[p.id];
        if (!d) return p;
        return {
          ...p,
          selling_price: d.selling_price !== undefined ? d.selling_price : p.selling_price,
          market_price: d.market_price !== undefined ? d.market_price : p.market_price
        };
      }),
    [rows, drafts]
  );

  const categories = useMemo(() => {
    const seen = new Set();
    for (const p of effective) {
      if (p.category) seen.add(p.category);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [effective]);

  // Search and category first, so the count beside every filter option answers
  // "how many of the products I am already looking at match this?" rather than a
  // number taken from the whole catalogue that ignores the search box.
  const scoped = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return effective.filter(
      (p) =>
        (!catFilter || p.category === catFilter) &&
        (!q ||
          [p.name, p.sku, p.category]
            .filter(Boolean)
            .some((v) => v.toLowerCase().includes(q)))
    );
  }, [effective, debouncedSearch, catFilter]);

  const filterCounts = useMemo(() => {
    const out = {};
    for (const f of PRICE_FILTERS) out[f.value] = 0;
    for (const p of scoped) {
      for (const f of PRICE_FILTERS) {
        if (f.test(p)) out[f.value] += 1;
      }
    }
    return out;
  }, [scoped]);

  const filtered = useMemo(() => {
    const active = FILTERS_BY_VALUE[filter];
    return active ? scoped.filter(active.test) : scoped;
  }, [scoped, filter]);

  const hasNarrowing = !!(filter || catFilter);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filter, catFilter]);

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

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter products by price or margin"
          className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-64 ${
            filter ? "border-indigo-300 font-medium text-indigo-700" : "border-slate-200 text-slate-600"
          }`}
        >
          <option value="">All products</option>
          {FILTER_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.values.map((value) => {
                const f = FILTERS_BY_VALUE[value];
                return (
                  <option key={value} value={value}>
                    {f.label} ({filterCounts[value].toLocaleString("en-US")})
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>

        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          aria-label="Filter products by category"
          className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-48 ${
            catFilter ? "border-indigo-300 font-medium text-indigo-700" : "border-slate-200 text-slate-600"
          }`}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <p className="text-xs text-slate-400">
          {loading
            ? "Loading…"
            : `${filtered.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} products`}
        </p>

        {(hasNarrowing || search) && (
          <button
            type="button"
            onClick={() => {
              setFilter("");
              setCatFilter("");
              setSearch("");
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
            Clear
          </button>
        )}
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
            <p className="mt-4 font-semibold text-slate-900">
              {rows.length === 0 ? "No products yet" : "No matching products"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {rows.length === 0
                ? "Add products first to manage their prices."
                : "Try a different search term, category or filter."}
            </p>
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
                    const saving = savingPerUnit(p);
                    const margin = marginPerUnit(p);
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
                const saving = savingPerUnit(p);
                const margin = marginPerUnit(p);
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