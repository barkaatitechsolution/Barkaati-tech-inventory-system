import { useEffect, useMemo, useState } from "react";
import { BadgePercent, Copy, Pencil, Plus, Ticket, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import { shareText } from "../lib/share.js";
import {
  Badge,
  Button,
  Card,
  Confirm,
  Empty,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  cx,
  showToast
} from "../components/ui.jsx";

const TYPES = [{ value: "percent", label: "Percent off" }, { value: "rupee", label: "Rupees off" }];
const blankCampaign = () => ({
  name: "",
  discount_type: "percent",
  discount_value: "",
  min_total: "",
  valid_from: "",
  valid_through: "",
  months: "1",
  active: true
});
const blankVoucher = () => ({ campaign_id: "", customer_id: "", customer_name: "" });

const campaignTone = { active: "green", upcoming: "blue", ended: "slate", inactive: "red" };

export default function Vouchers() {
  const { version, bump } = useApp();
  const [tab, setTab] = useState("campaigns");
  const campaigns = useAsync(() => api.voucherCampaigns(), [version]);
  const vouchers = useAsync(() => api.vouchers(), [version]);
  const customers = useAsync(() => api.customers(), [version]);
  const [campOpen, setCampOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankCampaign);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherForm, setVoucherForm] = useState(blankVoucher);
  const [saving, setSaving] = useState(false);
  const [deletingCampaign, setDeletingCampaign] = useState(null);
  const [deletingVoucher, setDeletingVoucher] = useState(null);

  useEffect(() => {
    if (campOpen) setForm(editing ? formFrom(editing) : blankCampaign());
  }, [campOpen, editing]);

  const campRows = campaigns.data || [];
  const voucherRows = vouchers.data || [];
  const customerRows = customers.data || [];

  const activeVouchers = useMemo(() => voucherRows.filter((v) => v.status === "active" && Number(v.uses_left) > 0), [voucherRows]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setV = (k) => (e) => setVoucherForm((f) => ({ ...f, [k]: e.target.value }));

  const saveCampaign = async () => {
    if (!form.name.trim()) return showToast("Enter a campaign name", "error");
    if (!(Number(form.discount_value) > 0)) return showToast("Enter a discount value", "error");
    setSaving(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        discount_value: Number(form.discount_value) || 0,
        min_total: Number(form.min_total) || 0,
        months: Number(form.months) || 1
      };
      if (editing) await api.updateVoucherCampaign(editing.id, payload);
      else await api.createVoucherCampaign(payload);
      showToast(editing ? "Campaign updated" : "Campaign created");
      setCampOpen(false);
      bump();
      campaigns.reload();
    } catch (e) {
      showToast(e?.message || "Could not save campaign", "error");
    } finally {
      setSaving(false);
    }
  };

  const createVoucher = async () => {
    if (!voucherForm.campaign_id) return showToast("Choose a campaign", "error");
    setSaving(true);
    try {
      const result = await api.createVoucher(voucherForm);
      setVoucherOpen(false);
      bump();
      vouchers.reload();
      showToast(`Voucher ${result.code} created`);
    } catch (e) {
      showToast(e?.message || "Could not create voucher", "error");
    } finally {
      setSaving(false);
    }
  };

  const shareVoucher = async (v) => {
    const discount = v.discount_type === "percent" ? `${Number(v.discount_value)}% off` : `${fmtMoney(v.discount_value)} off`;
    const text = `Hi ${v.customer_name || "there"}! Here is your voucher ${v.code} — ${discount}${Number(v.min_total) > 0 ? ` on orders above ${fmtMoney(v.min_total)}` : ""}. Valid for ${v.uses_left} use${Number(v.uses_left) === 1 ? "" : "s"}.`;
    await shareText({ title: "Voucher", text });
  };

  const removeCampaign = async () => {
    try {
      await api.deleteVoucherCampaign(deletingCampaign.id);
      showToast("Campaign deleted");
      setDeletingCampaign(null);
      bump();
      campaigns.reload();
      vouchers.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const removeVoucher = async () => {
    try {
      await api.deleteVoucher(deletingVoucher.id);
      showToast("Voucher deleted");
      setDeletingVoucher(null);
      bump();
      vouchers.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Discount vouchers"
        subtitle={`${campRows.length} campaigns · ${activeVouchers.length} active vouchers`}
        right={
          tab === "campaigns" ? (
            <Button size="sm" onClick={() => { setEditing(null); setCampOpen(true); }}><Plus className="h-4 w-4" /> Campaign</Button>
          ) : (
            <Button size="sm" onClick={() => { setVoucherForm(blankVoucher()); setVoucherOpen(true); }}><Plus className="h-4 w-4" /> Voucher</Button>
          )
        }
      />

      <div className="space-y-3 px-4">
        <div className="flex gap-2">
          {[
            { key: "campaigns", label: "Campaigns", icon: BadgePercent },
            { key: "vouchers", label: "Vouchers", icon: Ticket }
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={cx("flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                tab === key ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm")}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === "campaigns" ? (
          campaigns.loading ? <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
            : campRows.length ? (
              <div className="space-y-2">
                {campRows.map((c) => (
                  <Card key={c.id} className="p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-50 text-fuchsia-600">
                        <BadgePercent className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-slate-800">{c.name}</p>
                          <p className="shrink-0 text-sm font-bold text-slate-900">
                            {c.discount_type === "percent" ? `${Number(c.discount_value)}%` : fmtMoney(c.discount_value)}
                          </p>
                        </div>
                        <p className="truncate text-[11px] text-slate-400">
                          {Number(c.min_total) > 0 ? `Min ${fmtMoney(c.min_total)} · ` : ""}
                          {c.valid_from ? `From ${fmtDate(c.valid_from)} ` : ""}
                          {c.valid_through ? `to ${fmtDate(c.valid_through)}` : ""}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <Badge tone={campaignTone[c.computed_status] || "slate"}>{c.computed_status}</Badge>
                          <Badge tone="slate">{c.months} month{c.months === 1 ? "" : "s"}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setVoucherForm({ ...blankVoucher(), campaign_id: String(c.id) }); setVoucherOpen(true); }}>
                        <Ticket className="h-3.5 w-3.5" /> Issue
                      </Button>
                      <IconButton onClick={() => { setEditing(c); setCampOpen(true); }} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton onClick={() => setDeletingCampaign(c)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty icon={BadgePercent} title="No campaigns" description="Create a discount campaign and issue voucher codes."
                action={<Button onClick={() => { setEditing(null); setCampOpen(true); }}>New campaign</Button>} />
            )
        ) : vouchers.loading ? <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
          : voucherRows.length ? (
            <div className="space-y-2">
              {voucherRows.map((v) => (
                <Card key={v.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-50 font-mono text-xs font-bold text-fuchsia-700">
                      {v.code}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{v.customer_name || "Open voucher"}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {v.campaign_name || "Campaign"} · {v.discount_type === "percent" ? `${Number(v.discount_value)}% off` : `${fmtMoney(v.discount_value)} off`}
                      </p>
                    </div>
                    <Badge tone={v.status === "active" ? "green" : "slate"}>{v.status === "active" ? `${v.uses_left} left` : v.status}</Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => shareVoucher(v)}><Copy className="h-3.5 w-3.5" /> Share</Button>
                    <IconButton onClick={() => setDeletingVoucher(v)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Empty icon={Ticket} title="No vouchers" description="Issue voucher codes to customers from a campaign."
              action={<Button onClick={() => setVoucherOpen(true)}>Issue voucher</Button>} />
          )}
      </div>

      <Modal open={campOpen} title={editing ? "Edit campaign" : "New campaign"} onClose={() => setCampOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={saveCampaign}>Save campaign</Button>}>
        <div className="space-y-3">
          <Field label="Campaign name"><Input value={form.name} onChange={set("name")} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <Select value={form.discount_type} onChange={set("discount_type")}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Discount"><Input value={form.discount_value} onChange={set("discount_value")} inputMode="decimal" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min bill (Rs)"><Input value={form.min_total} onChange={set("min_total")} inputMode="decimal" /></Field>
            <Field label="Uses per voucher"><Input value={form.months} onChange={set("months")} inputMode="numeric" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Valid from"><Input type="date" value={form.valid_from} onChange={set("valid_from")} /></Field>
            <Field label="Valid through"><Input type="date" value={form.valid_through} onChange={set("valid_through")} /></Field>
          </div>
          <Field label="Active">
            <Select value={form.active ? "1" : "0"} onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "1" }))}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal open={voucherOpen} title="Issue voucher" onClose={() => setVoucherOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={createVoucher}>Create voucher</Button>}>
        <div className="space-y-3">
          <Field label="Campaign">
            <Select value={voucherForm.campaign_id} onChange={setV("campaign_id")}>
              <option value="">Choose a campaign</option>
              {campRows.filter((c) => c.computed_status === "active").map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Existing customer">
            <Select value={voucherForm.customer_id} onChange={setV("customer_id")}>
              <option value="">Walk-in / not linked</option>
              {customerRows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Customer name (if not linked)">
            <Input value={voucherForm.customer_name} onChange={setV("customer_name")} placeholder="Optional" />
          </Field>
        </div>
      </Modal>

      <Confirm open={!!deletingCampaign} title="Delete campaign?" message="Vouchers issued from it will stay but become unlinked."
        onClose={() => setDeletingCampaign(null)} onConfirm={removeCampaign} />
      <Confirm open={!!deletingVoucher} title="Delete voucher?" message="This voucher code will stop working."
        onClose={() => setDeletingVoucher(null)} onConfirm={removeVoucher} />
    </div>
  );
}

function formFrom(c) {
  return {
    name: c.name || "",
    discount_type: c.discount_type || "percent",
    discount_value: String(c.discount_value ?? ""),
    min_total: String(c.min_total ?? ""),
    valid_from: String(c.valid_from || "").slice(0, 10),
    valid_through: String(c.valid_through || "").slice(0, 10),
    months: String(c.months ?? 1),
    active: !!c.active
  };
}
