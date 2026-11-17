import { useMemo, useState } from "react";
import { Check, Mail, MessageSquare, Search, Send } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import { fillTemplate, shareToEmail, shareToSms } from "../lib/share.js";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Spinner, Textarea, cx, showToast } from "../components/ui.jsx";

const TEMPLATES = [
  { label: "New stock", text: "Hello {{name}}, new stock has arrived at {{store}}. Visit us today!" },
  { label: "Payment reminder", text: "Hello {{name}}, please clear your pending balance with {{store}} at your convenience." },
  { label: "Offer", text: "Hello {{name}}, {{store}} has a special offer running now. Don't miss out!" },
  { label: "Thank you", text: "Hello {{name}}, thank you for shopping with {{store}}." }
];

export default function SmsEmailBroadcast() {
  const { store } = useApp();
  const customers = useAsync(() => api.customers(), []);
  const [channel, setChannel] = useState("sms");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState({});
  const [subject, setSubject] = useState("Update from {{store}}");
  const [message, setMessage] = useState(TEMPLATES[0].text);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(0);

  const rows = customers.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => [c.name, c.phone, c.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const chosen = rows.filter((c) => selected[c.id]);
  const reachable = chosen.filter((c) => (channel === "email" ? c.email : c.phone));

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const selectAll = () => {
    const next = {};
    for (const c of filtered) if (channel === "email" ? c.email : c.phone) next[c.id] = true;
    setSelected(next);
  };

  const send = async () => {
    if (!reachable.length) return showToast(`Select at least one customer with ${channel === "email" ? "an email" : "a phone"}`, "error");
    if (!message.trim()) return showToast("Write a message", "error");
    setSending(true);
    setSent(0);
    let count = 0;
    try {
      for (const c of reachable) {
        const text = fillTemplate(message, {
          name: c.name || "customer",
          store: store?.name || "our shop",
          balance: "",
          phone: store?.phone || ""
        });
        if (channel === "email") {
          await shareToEmail(c.email, fillTemplate(subject, { store: store?.name || "our shop", name: c.name || "" }), text);
        } else {
          await shareToSms(c.phone, text);
        }
        count += 1;
        setSent(count);
      }
      showToast(`Opened ${channel === "email" ? "email" : "SMS"} for ${count} customer${count === 1 ? "" : "s"}`);
    } catch (e) {
      showToast(e?.message || "Could not open the app", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pb-24">
      <PageHeader title="SMS & email" subtitle={`${reachable.length} of ${chosen.length} reachable`} />

      <div className="space-y-3 px-4">
        <div className="flex gap-2">
          {[{ key: "sms", label: "SMS", icon: MessageSquare }, { key: "email", label: "Email", icon: Mail }].map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => { setChannel(key); setSelected({}); }}
              className={cx("flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                channel === key ? "bg-brand-700 text-white" : "bg-white text-slate-600 shadow-sm")}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <Card className="space-y-2 p-3">
          <Field label="Message template">
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button" onClick={() => setMessage(t.text)}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 active:bg-slate-200">
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          {channel === "email" ? (
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          ) : null}
          <Field label="Message" hint="Use {{name}} and {{store}} as placeholders.">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} />
          </Field>
        </Card>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers" />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={selectAll}>Select all</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected({})}>Clear</Button>
          </div>
          <Badge tone="blue">{chosen.length} selected</Badge>
        </div>

        {customers.loading ? (
          <div className="flex justify-center py-10"><Spinner className="text-brand-600" /></div>
        ) : filtered.length ? (
          <div className="space-y-1.5">
            {filtered.map((c) => {
              const active = !!selected[c.id];
              const contact = channel === "email" ? c.email : c.phone;
              return (
                <button key={c.id} type="button" onClick={() => toggle(c.id)}
                  className={cx("flex w-full items-center gap-3 rounded-xl border p-3 text-left",
                    active ? "border-brand-300 bg-brand-50" : "border-slate-100 bg-white")}>
                  <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                    active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300")}>
                    {active ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{c.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{contact || `No ${channel === "email" ? "email" : "phone"}`}</span>
                  </span>
                  {contact ? (channel === "email" ? <Mail className="h-4 w-4 text-brand-500" /> : <MessageSquare className="h-4 w-4 text-emerald-500" />) : <Badge tone="red">Missing</Badge>}
                </button>
              );
            })}
          </div>
        ) : (
          <Empty icon={MessageSquare} title="No customers" description="Add customers with contact details first." />
        )}

        <Button className="w-full" size="lg" loading={sending} onClick={send}>
          <Send className="h-4 w-4" /> {sending ? `Opening ${sent}/${reachable.length}…` : `Send to ${reachable.length} by ${channel === "email" ? "email" : "SMS"}`}
        </Button>
        <p className="text-center text-[11px] text-slate-400">
          Your {channel === "email" ? "email" : "SMS"} app opens for each customer. Press send there to deliver.
        </p>
      </div>
    </div>
  );
}
