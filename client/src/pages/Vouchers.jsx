import { useEffect, useMemo, useState } from "react";
import { TicketPercent, Plus, Printer, Trash2, Pencil, ChevronDown, ChevronUp, BadgePercent, Wallet } from "lucide-react";
import { api } from "../api.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { printVoucherCards } from "../lib/receipt.js";
import { fmtMoney, fmtDate, toDateInput } from "../lib/format.js";
import Card from "../components/Card.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Input, Button } from "../components/Field.jsx";

const statusBadge = (s) => {
  const map = {
    active: "bg-indigo-50 text-indigo-700",
    upcoming: "bg-amber-50 text-amber-700",
    ended: "bg-slate-100 text-slate-500"
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${map[s] || map.active}`}>
      {s}
    </span>
  );
};

const discountLabel = (c) =>
  c.discount_type === "percent" ? `${Number(c.discount_value) || 0}% OFF` : `Rs ${Number(c.discount_value) || 0} OFF`;

export default function Vouchers() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [builder, setBuilder] = useState({ open: false, editing: null });
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [expanded, setExpanded] = useState(null);
  const [vouchers, setVouchers] = useState([]);
  const [vFilter, setVFilter] = useState("all");
  const [vLoading, setVLoading] = useState(false);

  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setCampaigns(await api.voucherCampaigns());
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

  const loadCampaigns = async () => {
    try {
      setCampaigns(await api.voucherCampaigns());
    } catch (e) {
      setToast(e.message);
    }
  };

  const loadVouchers = async (campaignId, filter = vFilter) => {
    setVLoading(true);
    try {
      const qs = `campaign_id=${campaignId}${filter !== "all" ? `&status=${filter}` : ""}`;
      setVouchers(await api.vouchers(qs));
    } catch (e) {
      setToast(e.message);
    } finally {
      setVLoading(false);
    }
  };

  const toggleExpand = async (id) => {
    if (expanded === id) {
      setExpanded(null);
      setVouchers([]);
      return;
    }
    setExpanded(id);
    setVFilter("all");
    await loadVouchers(id, "all");
  };

  const stats = useMemo(() => {
    return campaigns.reduce(
      (a, c) => {
        a.active += c.computed_status === "active" ? 1 : 0;
        a.issued += Number(c.issued_count) || 0;
        a.redeemed += Number(c.redeemed_count) || 0;
        return a;
      },
      { campaigns: campaigns.length, active: 0, issued: 0, redeemed: 0 }
    );
  }, [campaigns]);

  const openCreate = () => {
    setForm(emptyForm());
    setBuilder({ open: true, editing: null });
  };

  const openEdit = (c) => {
    setForm({
      name: c.name || "",
      discount_type: c.discount_type || "rupee",
      discount_value: String(Number(c.discount_value) || ""),
      quantity: String(c.quantity != null ? c.quantity : 1000),
      issue_limit: String(c.issue_limit != null ? c.issue_limit : 300),
      min_total: String(c.min_total != null ? c.min_total : 0),
      months: String(c.months != null ? c.months : 5),
      start: c.start_date ? toDateInput(c.start_date) : ""
    });
    setBuilder({ open: true, editing: c });
  };

  const submitBuilder = async () => {
    if (!form.name.trim()) {
      setToast("Enter a voucher name");
      return;
    }
    const value = Number(form.discount_value);
    if (!value || value <= 0) {
      setToast("Enter the discount value (Rs or %)");
      return;
    }
    const months = Math.round(Number(form.months));
    if (!months || months < 1 || months > 24) {
      setToast("Months must be between 1 and 24");
      return;
    }
    const payload = {
      name: form.name.trim(),
      discount_type: form.discount_type,
      discount_value: value,
      quantity: Math.max(0, Number(form.quantity) || 0),
      issue_limit: Math.max(0, Number(form.issue_limit) || 0),
      min_total: Math.max(0, Number(form.min_total) || 0),
      months,
      start_date: form.start || null,
      end_date: null
    };
    setSaving(true);
    try {
      if (builder.editing) {
        await api.updateVoucherCampaign(builder.editing.id, payload);
        setToast("Voucher building updated");
      } else {
        await api.createVoucherCampaign(payload);
        setToast("Voucher building created");
      }
      setBuilder({ open: false, editing: null });
      await loadCampaigns();
    } catch (e) {
      setToast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const printPreview = () => {
    printVoucherCards(getStoreInfo(), [
      {
        code: "____",
        campaign_name: form.name.trim() || "Offer",
        discount_type: form.discount_type,
        discount_value: form.discount_value,
        min_total: form.min_total,
        months: form.months || 5,
        customer_name: "",
        status: "issued"
      }
    ]);
  };

  const printCampaignVouchers = (c) => {
    const items = vouchers
      .filter((v) => v.campaign_id === c.id)
      .map((v) => ({
        code: v.code,
        campaign_name: c.name,
        discount_type: c.discount_type,
        discount_value: c.discount_value,
        min_total: c.min_total,
        months: c.months,
        customer_name: v.customer_name,
        status: v.status,
        uses_left: v.uses_left,
        valid_through: v.valid_through || c.valid_through
      }));
    printVoucherCards(getStoreInfo(), items.length ? items : []);
  };

  const removeCampaign = async () => {
    try {
      await api.deleteVoucherCampaign(confirm.id);
      setConfirm(null);
      setToast("Voucher building deleted");
      if (expanded === confirm.id) {
        setExpanded(null);
        setVouchers([]);
      }
      await loadCampaigns();
    } catch (e) {
      setToast(e.message);
    }
  };

  const removeVoucher = async () => {
    try {
      await api.deleteVoucher(confirm.id);
      setConfirm(null);
      setToast("Voucher deleted");
      await loadVouchers(expanded, vFilter);
      await loadCampaigns();
    } catch (e) {
      setToast(e.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <TicketPercent className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">Voucher Buildings</p>
            <p className="text-xs text-slate-500">
              Build a voucher, pick an offer period — the first customers who buy get a 4-digit code printed on their bill, usable once every month
            </p>
          </div>
        </div>
        <Button onClick={openCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" /> Build voucher
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Buildings", value: stats.campaigns, cls: "text-slate-800" },
          { label: "Active now", value: stats.active, cls: "text-indigo-600" },
          { label: "Vouchers issued", value: stats.issued, cls: "text-amber-600" },
          { label: "Vouchers used", value: stats.redeemed, cls: "text-emerald-600" }
        ].map((s) => (
          <Card key={s.label} className="px-4 py-3 text-center">
            <p className={`text-lg font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-[10px] text-slate-400">{s.label}</p>
          </Card>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-rose-600">Failed to load voucher buildings: {error}</p>
      ) : loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : campaigns.length === 0 ? (
        <Card className="p-10 text-center">
          <TicketPercent className="mx-auto h-10 w-10 text-slate-200" />
          <p className="mt-3 font-semibold text-slate-700">No voucher buildings yet</p>
<p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
              Build one — e.g. "Holi 2026", Rs 200 off on minimum shopping of Rs 2000, valid for the next 5 months, once every month.
            </p>
          <Button className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Build voucher
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => {
            const pct = c.issue_limit > 0 ? Math.min(100, Math.round((Number(c.issued_count) / c.issue_limit) * 100)) : 0;
            const remaining = Math.max(0, (Number(c.issue_limit) || 0) - (Number(c.issued_count) || 0));
            return (
              <Card key={c.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-slate-900">{c.name}</p>
                      {statusBadge(c.computed_status)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="text-lg font-bold text-amber-600">{discountLabel(c)}</span>
                      {Number(c.min_total) > 0 && (
                        <span className="text-xs font-medium text-slate-600">on min shopping <b>{fmtMoney(c.min_total)}</b></span>
                      )}
                      <span className="text-xs text-slate-500">
                        from {c.start_date ? fmtDate(c.start_date) : "anytime"} · valid {c.months || 0} month{(c.months || 0) > 1 ? "s" : ""} · use once per month
                      </span>
                      <span className="text-xs text-slate-400">Print target · {c.quantity || 0}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="soft" size="sm" onClick={() => printCampaignVouchers(c)} disabled={!vouchers.some((v) => v.campaign_id === c.id)}>
                      <Printer className="h-4 w-4" /> Print ({vouchers.filter((v) => v.campaign_id === c.id).length || 0})
                    </Button>
                    <button onClick={() => openEdit(c)} className="rounded-lg p-2 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600" aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setConfirm({ kind: "campaign", id: c.id, name: c.name })} className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label="Delete building">
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => toggleExpand(c.id)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100" aria-label="Toggle vouchers">
                      {expanded === c.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="font-semibold text-slate-700">{c.issued_count} issued</span>
                    <span className="text-slate-500">{remaining} left · limit {c.issue_limit}</span>
                    <span className="font-semibold text-emerald-600">{c.redeemed_count} used</span>
                  </div>
                </div>

                {expanded === c.id && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-700">Issued vouchers</p>
                      <div className="flex flex-wrap items-center gap-1">
                        {[
                          { key: "all", label: "All" },
                          { key: "issued", label: "Issued" },
                          { key: "used", label: "Used" }
                        ].map((f) => (
                          <button
                            key={f.key}
                            onClick={() => {
                              setVFilter(f.key);
                              loadVouchers(c.id, f.key);
                            }}
                            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                              vFilter === f.key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {vLoading ? (
                      <p className="py-3 text-xs text-slate-400">Loading…</p>
                    ) : vouchers.length === 0 ? (
                      <p className="py-3 text-xs text-slate-400">
                        No vouchers yet. Vouchers auto-generate on bills of customers who buy after the start date (first {c.issue_limit}).
                      </p>
                    ) : (
                      <>
                        <div className="mt-2 space-y-2 sm:hidden">
                        {vouchers.map((v) => (
                        <div key={v.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-base font-bold text-slate-800">{v.code}</span>
                            {v.status === "used" || v.status === "redeemed" ? (
                              <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Used</span>
                            ) : (
                              <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">Issued</span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-600">{v.customer_name || "No customer name"}</p>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-500">
                            <span>
                              Bill {v.bill_id ? `#${v.bill_id}` : "—"} · {v.issued_at ? fmtDate(v.issued_at) : "—"}
                            </span>
                            <span>
                              {v.use_count > 0 ? (
                                <>
                                  <span className="font-semibold text-emerald-600">{v.use_count}</span>
                                  <span>/{v.months || 0} · left {v.uses_left}</span>
                                  {v.used_this_month ? <span className="ml-1 text-amber-600">(this month ✓)</span> : null}
                                </>
                              ) : (
                                <span>0/{v.months || 0}</span>
                              )}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2">
                            <Button variant="soft" size="sm" className="!px-2.5 !py-1.5 text-xs"
                              onClick={() =>
                                printVoucherCards(getStoreInfo(), [
                                  {
                                    code: v.code,
                                    campaign_name: c.name,
                                    discount_type: c.discount_type,
                                    discount_value: c.discount_value,
                                    min_total: c.min_total,
                                    months: c.months,
                                    customer_name: v.customer_name,
                                    status: v.status,
                                    uses_left: v.uses_left,
                                    valid_through: v.valid_through
                                  }
                                ])
                              }
                            >
                              <Printer className="h-3.5 w-3.5" /> Print card
                            </Button>
                            <button
                              onClick={() => setConfirm({ kind: "voucher", id: v.id, name: v.code })}
                              className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Delete voucher"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 hidden overflow-x-auto sm:block">
                      <table className="w-full min-w-[680px] text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                              <th className="px-2 py-2 font-semibold">Code</th>
                              <th className="px-2 py-2 font-semibold">Customer</th>
                              <th className="px-2 py-2 font-semibold">Issue bill</th>
                              <th className="px-2 py-2 font-semibold">Issued on</th>
                              <th className="px-2 py-2 font-semibold">Uses</th>
                              <th className="px-2 py-2 font-semibold">Status</th>
                              <th className="px-2 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {vouchers.map((v) => (
                              <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                                <td className="px-2 py-2 font-mono text-sm font-bold text-slate-800">{v.code}</td>
                                <td className="px-2 py-2 text-xs text-slate-600">{v.customer_name || "—"}</td>
                                <td className="px-2 py-2 text-xs text-slate-500">{v.bill_id ? `#${v.bill_id}` : "—"}</td>
                                <td className="px-2 py-2 text-xs text-slate-500">{v.issued_at ? fmtDate(v.issued_at) : "—"}</td>
                                <td className="px-2 py-2 text-xs text-slate-600">
                                  {v.use_count > 0 ? (
                                    <>
                                      <span className="font-semibold text-emerald-600">{v.use_count}</span>
                                      <span className="text-slate-400">/{v.months || 0} · left {v.uses_left}</span>
                                      {v.used_this_month ? <span className="ml-1 text-amber-600">(this month ✓)</span> : null}
                                    </>
                                  ) : (
                                    <span className="text-slate-400">0/{v.months || 0}</span>
                                  )}
                                </td>
                                <td className="px-2 py-2">
                                  {v.status === "used" || v.status === "redeemed" ? (
                                    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Used</span>
                                  ) : (
                                    <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">Issued</span>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <button
                                    onClick={() =>
                                      printVoucherCards(getStoreInfo(), [
                                        {
                                          code: v.code,
                                          campaign_name: c.name,
                                          discount_type: c.discount_type,
                                          discount_value: c.discount_value,
                                          min_total: c.min_total,
                                          months: c.months,
                                          customer_name: v.customer_name,
                                          status: v.status,
                                          uses_left: v.uses_left,
                                          valid_through: v.valid_through
                                        }
                                      ])
                                    }
                                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                                    aria-label="Print voucher (thermal / A4)"
                                  >
                                    <Printer className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => setConfirm({ kind: "voucher", id: v.id, name: v.code })}
                                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                                    aria-label="Delete voucher"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={builder.open}
        onClose={() => setBuilder({ open: false, editing: null })}
        title={builder.editing ? "Edit voucher building" : "Build a voucher"}
        subtitle="After the start date, the first customers who purchase get a voucher code printed on their bill — usable once every month"
        footer={
          <>
            <Button variant="ghost" onClick={printPreview}>
              <Printer className="h-4 w-4" /> Print preview
            </Button>
            <Button variant="ghost" onClick={() => setBuilder({ open: false, editing: null })}>
              Cancel
            </Button>
            <Button onClick={submitBuilder} disabled={saving}>
              {saving ? "Saving…" : builder.editing ? "Save changes" : "Create building"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Voucher name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Diwali 2026" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discount type">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, discount_type: "rupee" })}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
                    form.discount_type === "rupee" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500"
                  }`}
                >
                  <Wallet className="h-4 w-4" /> Rupee (Rs)
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, discount_type: "percent" })}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
                    form.discount_type === "percent" ? "bg-white text-amber-700 shadow-sm" : "text-slate-500"
                  }`}
                >
                  <BadgePercent className="h-4 w-4" /> Percent (%)
                </button>
              </div>
            </Field>
            <Field label={form.discount_type === "percent" ? "Discount value (%)" : "Discount value (Rs)"}>
              <Input type="number" min="0" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} placeholder={form.discount_type === "percent" ? "e.g. 10" : "e.g. 100"} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Print target (no. of vouchers)">
              <Input type="number" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="1000" />
            </Field>
            <Field label="Customers to give it to (limit)">
              <Input type="number" min="0" value={form.issue_limit} onChange={(e) => setForm({ ...form, issue_limit: e.target.value })} placeholder="300" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum shopping to use (Rs, 0 = none)">
              <Input type="number" min="0" value={form.min_total} onChange={(e) => setForm({ ...form, min_total: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Valid for next (months) — use once each month">
              <Input type="number" min="1" max="24" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} placeholder="5" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Offer start date">
              <Input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </Field>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <span className="font-bold">{form.name.trim() || "This voucher"} </span>
            → <span className="font-bold">{discountLabel({ discount_type: form.discount_type, discount_value: form.discount_value })}</span>
            {Number(form.min_total) > 0 ? (
              <> on minimum shopping of <span className="font-bold">{fmtMoney(form.min_total)}</span></>
            ) : null}{" "}
            for the first <span className="font-bold">{form.issue_limit || 300}</span> customers buying from{" "}
            <span className="font-bold">{form.start || "anytime"}</span>. Each code is unique (4 digits) and can be used{" "}
            <span className="font-bold">once every month</span> for the next <span className="font-bold">{form.months || 5} months</span>.
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === "campaign" ? "Delete voucher building?" : "Delete voucher?"}
        message={
          confirm?.kind === "campaign"
            ? `Delete "${confirm?.name || "this building"}" and all ${confirm?.id ? "" : ""}vouchers issued from it? This cannot be undone.`
            : `Delete voucher code ${confirm?.name || ""}? This cannot be undone.`
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "campaign") removeCampaign();
          else removeVoucher();
          setConfirm(null);
        }}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function emptyForm() {
  return {
    name: "",
    discount_type: "rupee",
    discount_value: "",
    quantity: "1000",
    issue_limit: "300",
    min_total: "0",
    months: "5",
    start: ""
  };
}