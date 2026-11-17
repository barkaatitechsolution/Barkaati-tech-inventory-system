import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Pencil, Phone, PhoneCall, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fmtDateTime } from "../lib/format.js";
import { smsUrl, openUrl } from "../lib/share.js";
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

const PRIORITIES = ["low", "normal", "high", "urgent"];
const FILTERS = ["pending", "done", "all"];
const blank = () => ({
  contact_name: "",
  phone: "",
  note: "",
  call_back_at: "",
  priority: "normal",
  status: "pending"
});

const priorityTone = { low: "slate", normal: "blue", high: "amber", urgent: "red" };

export default function CallNotes() {
  const { version, bump } = useApp();
  const notes = useAsync(() => api.callNotes(), [version]);
  const [filter, setFilter] = useState("pending");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (open) setForm(editing ? formFrom(editing) : blank());
  }, [open, editing]);

  const rows = notes.data || [];
  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const pending = rows.filter((r) => r.status === "pending").length;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.contact_name.trim()) return showToast("Enter a contact name", "error");
    setSaving(true);
    try {
      const payload = { ...form, contact_name: form.contact_name.trim() };
      if (editing) await api.updateCallNote(editing.id, payload);
      else await api.createCallNote(payload);
      showToast(editing ? "Call note updated" : "Call note added");
      setOpen(false);
      bump();
      notes.reload();
    } catch (e) {
      showToast(e?.message || "Could not save call note", "error");
    } finally {
      setSaving(false);
    }
  };

  const markDone = async (row) => {
    try {
      await api.updateCallNoteStatus(row.id, { status: row.status === "done" ? "pending" : "done" });
      bump();
      notes.reload();
    } catch (e) {
      showToast(e?.message || "Could not update", "error");
    }
  };

  const call = async (row) => {
    if (!row.phone) return showToast("No phone number saved", "error");
    await openUrl(`tel:${String(row.phone).replace(/[^\d+]/g, "")}`);
  };

  const text = async (row) => {
    if (!row.phone) return showToast("No phone number saved", "error");
    await openUrl(smsUrl(row.phone, ""));
  };

  const remove = async () => {
    try {
      await api.deleteCallNote(deleting.id);
      showToast("Call note deleted");
      setDeleting(null);
      bump();
      notes.reload();
    } catch (e) {
      showToast(e?.message || "Could not delete", "error");
    }
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Call back notes"
        subtitle={`${pending} pending`}
        right={<Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" /> Add</Button>}
      />

      <div className="space-y-3 px-4">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={cx("flex-1 rounded-full px-3 py-1.5 text-xs font-semibold capitalize",
                filter === f ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm")}>
              {f}
            </button>
          ))}
        </div>

        {notes.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : notes.error ? (
          <Card className="border border-red-100 bg-red-50"><p className="text-sm text-red-700">{notes.error}</p></Card>
        ) : filtered.length ? (
          <div className="space-y-2">
            {filtered.map((r) => {
              const done = r.status !== "pending";
              return (
                <Card key={r.id} className={cx("p-3", done && "opacity-60")}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <PhoneCall className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{r.contact_name}</p>
                      <p className="truncate text-[11px] text-slate-400">{r.phone || "No phone"}{r.note ? ` · ${r.note}` : ""}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={priorityTone[r.priority] || "slate"}>{r.priority}</Badge>
                        <Badge tone={done ? "green" : "amber"}>{r.status}</Badge>
                        {r.call_back_at ? <span className="text-[10px] text-slate-400">{fmtDateTime(r.call_back_at)}</span> : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => call(r)}><Phone className="h-3.5 w-3.5" /> Call</Button>
                      <Button size="sm" variant="ghost" onClick={() => text(r)}>SMS</Button>
                      <Button size="sm" variant="ghost" onClick={() => markDone(r)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> {done ? "Reopen" : "Done"}
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton onClick={() => { setEditing(r); setOpen(true); }} className="h-8 w-8 bg-slate-100 text-slate-600" aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton onClick={() => setDeleting(r)} className="h-8 w-8 bg-red-50 text-red-500" aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty icon={PhoneCall} title="No call notes" description="Save customer call backs so you never forget."
            action={<Button onClick={() => { setEditing(null); setOpen(true); }}>Add call note</Button>} />
        )}
      </div>

      <Modal open={open} title={editing ? "Edit call note" : "Add call note"} onClose={() => setOpen(false)}
        footer={<Button className="w-full" loading={saving} onClick={save}>Save call note</Button>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Contact name"><Input value={form.contact_name} onChange={set("contact_name")} autoFocus /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={set("phone")} inputMode="tel" /></Field>
          </div>
          <Field label="Note"><Textarea value={form.note} onChange={set("note")} rows={3} placeholder="What did they ask about?" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Call back at"><Input type="datetime-local" value={form.call_back_at} onChange={set("call_back_at")} /></Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={set("priority")}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Status">
            <Select value={form.status} onChange={set("status")}>
              <option value="pending">pending</option>
              <option value="done">done</option>
              <option value="cancelled">cancelled</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <Confirm open={!!deleting} title="Delete call note?" message="This call note will be removed."
        onClose={() => setDeleting(null)} onConfirm={remove} />
    </div>
  );
}

function formFrom(row) {
  return {
    contact_name: row.contact_name || "",
    phone: row.phone || "",
    note: row.note || "",
    call_back_at: row.call_back_at || "",
    priority: row.priority || "normal",
    status: row.status || "pending"
  };
}
