import { useEffect, useMemo, useState } from "react";
import { Handshake, Pencil, Plus, Search, Send, Trash2, Users } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDate } from "../lib/format.js";
import { shareToWhatsApp } from "../lib/share.js";
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
  Textarea,
  cx,
  showToast
} from "../components/ui.jsx";

const ENQUIRY_STATUSES = ["pending", "sent", "ordered", "received", "cancelled"];
const STATUS_TONE = { pending: "amber", sent: "blue", ordered: "purple", received: "green", cancelled: "red" };
const blankBroker = () => ({ name: "", phone: "", company: "", address: "", notes: "" });
const blankEnquiry = () => ({ broker_id: "", product_name: "", qty: "", unit: "pcs", notes: "" });

export default function Brokers() {
  const { version, bump } = useApp();
  const [tab, setTab] = useState("brokers");
  const brokers = useAsync(() => api.brokers(), [version]);
  const enquiries = useAsync(() => api.brokerEnquiries(), [version]);
  const [search, setSearch] = useState("");
  const [brokerOpen, setBrokerOpen] = useState(false);
  const [editingBroker, setEditingBroker] = useState(null);
  const [brokerForm, setBrokerForm] = useState(blankBroker);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [enquiryForm, setEnquiryForm] = useState(blankEnquiry);
  const [saving, setSaving] = useState(false);
  const [deletingBroker, setDeletingBroker] = useState(null);
  const [deletingEnquiry, setDeletingEnquiry] = useState(null);

  useEffect(() => {
    if (brokerOpen) setBrokerForm(editingBroker ? { ...editingBroker } : blankBroker());
  }, [brokerOpen, editingBroker]);

  const brokerRows = brokers.data || [];
  const enquiryRows = enquiries.data || [];
  const filteredBrokers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brokerRows;
    return brokerRows.filter((r) => [r.name, r.phone, r.company, r.address].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [brokerRows, search]);
  const filteredEnquiries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enquiryRows;
    return enquiryRows.filter((r) => [r.product_name, r.broker_name, r.reference_no, r.notes].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [enquiryRows, search]);

  const setBroker = (k) => (e) => setBrokerForm((f) => ({ ...f, [k]: e.target.value }));
  const setEnquiry = (k) => (e) => setEnquiryForm((f) => ({ ...f, [k]: e.target.value }));

  const saveBroker = async () => {
    if (!brokerForm.name.trim()) return showToast("Enter the broker name", "error");
    setSaving(true);
    try {
      if (editingBroker) await api.updateBroker(editingBroker.id, brokerForm);
      else await api.createBroker(brokerForm);
      showToast(editingBroker ? "Broker updated" : "Broker added");
      setBrokerOpen(false);
      bump();
      brokers.reload();
    } catch (e) {
      showToast(e?.message || "Could not save broker", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveEnquiry = async () => {
    if (!enquiryForm.broker_id) return showToast("Choose a broker", "error");
    if (!enquiryForm.product_name.trim()) return showToast("Enter a product", "error");
    if (!(Number(enquiryForm.qty) > 0)) return showToast("Enter a quantity", "error");
    setSaving(true);
    try {
      const result = await api.createBrokerEnquiry(enquiryForm);
      const broker = brokerRows.find((b) => String(b.id) === String(enquiryForm.broker_id));
      const message = `Hello ${broker?.name || "there"}, please quote for ${enquiryForm.qty} ${enquiryForm.unit} of ${enquiryForm.product_name}. Ref: ${result.reference_no}`;
      setEnquiryOpen(false);
      bump();
      enquiries.reload();
      showToast("Enquiry saved");
      await shareToWhatsApp(broker?.phone, message);
    } catch (e) {
      showToast(e?.message || "Could not save enquiry", "error");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (row, status) => {
    try {
      await api.updateBrokerEnquiryStatus(row.id, { status });
      bump();
      enquiries.reload();
    } catch (e) {
      showToast(e?.message || "Could not update", "error");
    }
  };

  const removeBroker = async () => {
    try {
      await api.deleteBroker(deletingBroker.id);
      showToast("Broker deleted");
      setDeletingBroker(null);
      bump();
      brokers.reload();
      enquiries.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const removeEnquiry = async () => {
    try {
      await api.deleteBrokerEnquiry(deletingEnquiry.id);
      showToast("Enquiry deleted");
      setDeletingEnquiry(null);
      bump();
      enquiries.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  const resend = async (row) => {
    const message = `Hello ${row.broker_name || "there"}, following up on enquiry ${row.reference_no} for ${row.qty} ${row.unit} of ${row.product_name}.`;
    await shareToWhatsApp(row.broker_phone, message);
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Brokers"
        subtitle={`${brokerRows.length} brokers · ${enquiryRows.length} enquiries`}
        right={
          tab === "brokers" ? (
            <Button size="sm" onClick={() => { setEditingBroker(null); setBrokerOpen(true); }}><Plus className="h-4 w-4" /> Broker</Button>
          ) : (
            <Button size="sm" onClick={() => { setEnquiryForm(blankEnquiry()); setEnquiryOpen(true); }}><Plus className="h-4 w-4" /> Enquiry</Button>
          )
        }
      />

      <div className="space-y-3 px-4">
        <div className="flex gap-2">
          {[
            { key: "brokers", label: "Brokers", icon: Users },
            { key: "enquiries", label: "Enquiries", icon: Send }
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={cx("flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                tab === key ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm")}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "brokers" ? "Search brokers" : "Search enquiries"} />
        </div>

        {tab === "brokers" ? (
          brokers.loading ? <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
            : filteredBrokers.length ? (
              <div className="space-y-2">
                {filteredBrokers.map((b) => (
                  <Card key={b.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                        <Handshake className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{b.name}</p>
                        <p className="truncate text-[11px] text-slate-400">{b.phone}{b.company ? ` · ${b.company}` : ""}</p>
                      </div>
                      <Badge tone="slate">{b.enquiry_count || 0} enquiries</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <Button size="sm" variant="ghost" onClick={() => { setEnquiryForm({ ...blankEnquiry(), broker_id: String(b.id) }); setEnquiryOpen(true); }}>
                        <Send className="h-3.5 w-3.5" /> Enquire
                      </Button>
                      <div className="flex items-center gap-1">
                        <IconButton onClick={() => { setEditingBroker(b); setBrokerOpen(true); }} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton onClick={() => setDeletingBroker(b)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty icon={Users} title="No brokers" description="Add brokers to send stock enquiries on WhatsApp."
                action={<Button onClick={() => { setEditingBroker(null); setBrokerOpen(true); }}>Add broker</Button>} />
            )
        ) : enquiries.loading ? <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
          : filteredEnquiries.length ? (
            <div className="space-y-2">
              {filteredEnquiries.map((e) => (
                <Card key={e.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                      <Send className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{e.product_name}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {e.qty} {e.unit} · {e.broker_name || "No broker"} · {e.reference_no}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={STATUS_TONE[e.status] || "slate"}>{e.status}</Badge>
                        <span className="text-[10px] text-slate-400">{fmtDate(e.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => resend(e)}><Send className="h-3.5 w-3.5" /> Resend</Button>
                      <Select className="h-9 w-28 py-0 text-xs" value={e.status} onChange={(ev) => setStatus(e, ev.target.value)}>
                        {ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </div>
                    <IconButton onClick={() => setDeletingEnquiry(e)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Empty icon={Send} title="No enquiries" description="Send a stock enquiry to a broker on WhatsApp."
              action={<Button onClick={() => setEnquiryOpen(true)}>New enquiry</Button>} />
          )}
      </div>

      <Modal open={brokerOpen} title={editingBroker ? "Edit broker" : "Add broker"} onClose={() => setBrokerOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={saveBroker}>Save broker</Button>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name"><Input value={brokerForm.name} onChange={setBroker("name")} autoFocus /></Field>
            <Field label="Phone"><Input value={brokerForm.phone} onChange={setBroker("phone")} inputMode="tel" /></Field>
          </div>
          <Field label="Company"><Input value={brokerForm.company} onChange={setBroker("company")} /></Field>
          <Field label="Address"><Input value={brokerForm.address} onChange={setBroker("address")} /></Field>
          <Field label="Notes"><Textarea value={brokerForm.notes} onChange={setBroker("notes")} rows={2} /></Field>
        </div>
      </Modal>

      <Modal open={enquiryOpen} title="New enquiry" onClose={() => setEnquiryOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={saveEnquiry}><Send className="h-4 w-4" /> Save & WhatsApp</Button>}>
        <div className="space-y-3">
          <Field label="Broker">
            <Select value={enquiryForm.broker_id} onChange={setEnquiry("broker_id")}>
              <option value="">Choose a broker</option>
              {brokerRows.map((b) => <option key={b.id} value={b.id}>{b.name}{b.company ? ` · ${b.company}` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Product"><Input value={enquiryForm.product_name} onChange={setEnquiry("product_name")} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity"><Input value={enquiryForm.qty} onChange={setEnquiry("qty")} inputMode="decimal" /></Field>
            <Field label="Unit"><Input value={enquiryForm.unit} onChange={setEnquiry("unit")} /></Field>
          </div>
          <Field label="Notes"><Textarea value={enquiryForm.notes} onChange={setEnquiry("notes")} rows={2} /></Field>
        </div>
      </Modal>

      <Confirm open={!!deletingBroker} title="Delete broker?" message="Enquiries will be kept but unlinked."
        onClose={() => setDeletingBroker(null)} onConfirm={removeBroker} />
      <Confirm open={!!deletingEnquiry} title="Delete enquiry?" message="This enquiry will be removed."
        onClose={() => setDeletingEnquiry(null)} onConfirm={removeEnquiry} />
    </div>
  );
}
