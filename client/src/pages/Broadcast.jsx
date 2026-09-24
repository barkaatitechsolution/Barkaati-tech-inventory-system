import { useEffect, useMemo, useRef, useState } from "react";
import {
  Megaphone,
  Search,
  Send,
  Play,
  Pause,
  Square,
  SkipForward,
  Users,
  Phone,
  Check,
  AlertTriangle,
  Copy
} from "lucide-react";
import { api } from "../api.js";
import { getStoreInfo } from "../lib/storeInfo.js";
import { normalizeWhatsAppNumber, sendWhatsApp as openWhatsApp } from "../lib/whatsapp.js";
import { fmtMoney } from "../lib/format.js";
import Card from "../components/Card.jsx";
import { Field, Input, Button } from "../components/Field.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function Countdown({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, until - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span className="tabular-nums font-bold text-indigo-700">
      {m}m {String(s).padStart(2, "0")}s
    </span>
  );
}

export default function Broadcast() {
  const store = getStoreInfo();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [autoPersonalize, setAutoPersonalize] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | credit | non-credit
  const [selected, setSelected] = useState({});
  const [selectAll, setSelectAll] = useState(true);
  const [batchSize, setBatchSize] = useState(10);
  const [gapMinutes, setGapMinutes] = useState(2);
  const [phase, setPhase] = useState("idle"); // idle | running | waiting | paused | done | stopped
  const [sent, setSent] = useState(0);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(null);
  const [waitingUntil, setWaitingUntil] = useState(null);
  const controller = useRef(null);
  const skipRef = useRef(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const load = async () => {
    setLoading(true);
    try {
      const c = await api.customers();
      setCustomers(c);
      const sel = {};
      c.forEach((x) => {
        if (x.phone) sel[x.id] = true;
      });
      setSelected(sel);
    } catch (e) {
      setToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const validPhones = useMemo(
    () => customers.filter((c) => normalizeWhatsAppNumber(c.phone)),
    [customers]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (!c.phone) return false;
      const bal = Number(c.balance) || 0;
      if (filter === "credit" && bal <= 0) return false;
      if (filter === "non-credit" && bal > 0) return false;
      if (q && ![c.name, c.phone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [customers, search, filter]);

  const selectPending = () => {
    const next = {};
    customers.forEach((c) => {
      if (c.phone && (Number(c.balance) || 0) > 0) next[c.id] = true;
    });
    setSelected(next);
    setSelectAll(false);
    setToast(`${Object.keys(next).length} customer${Object.keys(next).length === 1 ? "" : "s"} with pending bills selected`);
  };

  const toggleSelectAllFor = (on) => {
    setSelected((prev) => {
      const next = { ...prev };
      filtered.forEach((c) => {
        if (on) next[c.id] = true;
        else delete next[c.id];
      });
      return next;
    });
    setSelectAll(on);
  };

  const renderMessage = (c) => {
    const lines = [];
    if (subject.trim()) lines.push(`*${subject.trim()}*`);
    let bodyText = body.trim();
    const hasName = bodyText.includes("{name}");
    const hasBalance = bodyText.includes("{balance}");
    if (autoPersonalize && !hasName && c.name) bodyText = `Dear ${c.name},\n\n${bodyText}`;
    if (bodyText) lines.push(bodyText);
    const bal = Number(c.balance) || 0;
    if (autoPersonalize && bal > 0 && !hasBalance) {
      lines.push(`You have a pending bill of *${fmtMoney(bal)}* with us. Kindly settle it at your earliest convenience.`);
    }
    const raw = lines.join("\n\n");
    return raw
      .replaceAll("{name}", c.name || "")
      .replaceAll("{phone}", normalizeWhatsAppNumber(c.phone) || c.phone || "")
      .replaceAll("{balance}", fmtMoney(bal))
      .replaceAll("{store}", store.name || "");
  };

  const buildQueue = () =>
    customers
      .filter((c) => selected[c.id] && normalizeWhatsAppNumber(c.phone))
      .map((c) => ({ customer: c, text: renderMessage(c) }));

  const previewCustomer = useMemo(
    () => customers.find((c) => selected[c.id] && normalizeWhatsAppNumber(c.phone)),
    [customers, selected]
  );

  const copyToClipboard = (text) => {
    try {
      navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
  };

  const openFor = async (text, phone) => {
    copyToClipboard(text);
    const w = openWhatsApp(text, phone);
    if (w) w.focus();
    return w;
  };

  const runLoop = async (q, size, gapMs) => {
    const ctrl = controller.current;
    let i = 0;
    while (i < q.length && ctrl.active) {
      if (ctrl.paused) {
        setPhase("paused");
        while (ctrl.paused && ctrl.active) await sleep(500);
        if (!ctrl.active) break;
        setPhase("running");
      }
      const end = Math.min(i + size, q.length);
      for (let j = i; j < end; j++) {
        if (!ctrl.active) break;
        await openFor(q[j].text, q[j].customer.phone);
        setCurrent(q[j].customer);
        setSent(j + 1);
        if (j < end - 1) await sleep(2500);
      }
      i = end;
      if (i < q.length && ctrl.active) {
        if (gapMs > 0) {
          const when = Date.now() + gapMs;
          skipRef.current = false;
          setWaitingUntil(when);
          setPhase("waiting");
          while (Date.now() < when && ctrl.active && !skipRef.current) {
            if (ctrl.paused) {
              setPhase("paused");
              while (ctrl.paused && ctrl.active) await sleep(500);
              if (!ctrl.active) break;
              setPhase("waiting");
            } else {
              await sleep(1000);
            }
          }
          setWaitingUntil(null);
        }
      }
    }
    setPhase(ctrl.active ? "done" : "stopped");
    controller.current = null;
    if (gapMs <= 0 && i < q.length) setPhase("stopped");
  };

  const startBroadcast = () => {
    const q = buildQueue();
    if (q.length === 0) {
      setToast("No customers selected with a valid phone number");
      return;
    }
    setTotal(q.length);
    setSent(0);
    setCurrent(null);
    const ctrl = { active: true, paused: false };
    controller.current = ctrl;
    setPhase("running");
    const size = Math.min(100, Math.max(1, Number(batchSize) || 1));
    const gapMs = Math.max(0, Number(gapMinutes) || 0) * 60000;
    runLoop(q, size, gapMs).catch(() => {
      setPhase("stopped");
      controller.current = null;
      setToast("Broadcast stopped due to an error");
    });
  };

  const stopBroadcast = () => {
    if (controller.current) controller.current.active = false;
  };

  const pauseBroadcast = () => {
    if (controller.current) controller.current.paused = true;
  };

  const resumeBroadcast = () => {
    if (controller.current) controller.current.paused = false;
  };

  const skipWait = () => {
    skipRef.current = true;
  };

  const testMessage = () => {
    const c = previewCustomer;
    if (!c) {
      setToast("Select a customer with a phone number first");
      return;
    }
    openFor(renderMessage(c), c.phone);
  };

  const copyMessage = () => {
    const c = previewCustomer;
    if (!c) return;
    navigator.clipboard.writeText(renderMessage(c));
    setToast("Message copied for preview customer");
  };

  const reminderTemplate = () => {
    setSubject("Payment Reminder");
    setBody(
      "Hello {name},\n\nThis is a friendly reminder that you have a pending bill of {balance} with us.\n\nKindly settle it at your earliest convenience.\n\nThank you!\n{store}"
    );
    setToast("{balance} will show each customer's pending amount");
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const queued = buildQueue().length;
  const selectedPendingTotal = useMemo(
    () =>
      customers
        .filter((c) => selected[c.id] && normalizeWhatsAppNumber(c.phone))
        .reduce((a, c) => a + (Number(c.balance) || 0), 0),
    [customers, selected]
  );
  const pendingAllTotal = useMemo(
    () => customers.filter((c) => c.phone && (Number(c.balance) || 0) > 0).reduce((a, c) => a + (Number(c.balance) || 0), 0),
    [customers]
  );
  const inProgress = phase === "running" || phase === "waiting" || phase === "paused";
  const batchNo = total ? Math.min(Math.floor(sent / (Math.max(1, Number(batchSize) || 1))) + 1, Math.ceil(total / (Math.max(1, Number(batchSize) || 1))) || 1) : 0;
  const totalBatches = total ? Math.ceil(total / (Math.max(1, Number(batchSize) || 1))) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Megaphone className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">WhatsApp Broadcast</p>
            <p className="text-xs text-slate-500">
              Send offers & news to {validPhones.length} customer{validPhones.length === 1 ? "" : "s"} with a phone number
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Each tab opens the right customer's chat on WhatsApp — press <b>Send</b> in each tab. Each customer's
          message is copied to your clipboard right before its chat opens, so if the message isn't already typed
          just press <b>Paste (Ctrl+V)</b>. Keep WhatsApp Web / Desktop logged in and <b>allow pop-ups for this
          site</b> in the browser (use the browser's pop-up icon to allow if a tab is blocked).
          Pop-ups are opened in small gaps so the browser doesn't block them.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-4">
          <p className="text-sm font-bold text-slate-800">Offer / event message</p>
          <Field
            label="Subject"
            hint="Optional heading, shown bold at the top — e.g. *Festive Discount*"
          >
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Diwali Special 20% OFF"
            />
          </Field>
          <Field
            label="Message"
            hint='Placeholders: {name} · {phone} · {store} · {balance} — all replaced per customer'
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder={"Hello {name},\nWe have a special offer today — flat 15% off on all items!\nVisit {store} before stock runs out."}
              className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </Field>

          <label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={autoPersonalize}
              onChange={(e) => setAutoPersonalize(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>
              Personalize each message automatically — adds <b>Dear {`{name}`}</b> and the customer's pending-bill
              line when they owe money <span className="text-slate-400">(turns off if you use {`{name}`} or {`{balance}`} manually)</span>
            </span>
          </label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Live preview</p>
              <button onClick={copyMessage} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800">
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            {previewCustomer ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">
                {renderMessage(previewCustomer)}
              </p>
            ) : (
              <p className="text-xs text-slate-400">No customer selected yet.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="soft" onClick={testMessage} disabled={!previewCustomer}>
              <Send className="h-4 w-4" /> Test on WhatsApp
            </Button>
            <Button variant="soft" onClick={reminderTemplate} className="!text-amber-700">
              <AlertTriangle className="h-4 w-4" /> Payment reminder
            </Button>
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">Recipients</p>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              disabled={inProgress}
              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 outline-none transition focus:border-indigo-400 disabled:bg-slate-50"
            >
              <option value="all">All customers</option>
              <option value="credit">With pending bill</option>
              <option value="non-credit">No pending bill</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => toggleSelectAllFor(true)}>
              <Check className="h-3 w-3" /> All
            </Button>
            <Button type="button" variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => toggleSelectAllFor(false)}>
              None
            </Button>
            <Button type="button" variant="soft" className="!px-2 !py-1 text-xs !text-amber-700" onClick={selectPending}>
              <AlertTriangle className="h-3 w-3" /> Pending bills
            </Button>
          </div>
          <p className="text-[11px] text-slate-400">
            "Pending bills" auto-selects every customer owing money ({fmtMoney(pendingAllTotal)} in total) so you can
            send them all a reminder.
          </p>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers by name or phone…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="h-64 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                {search ? "No matching customers." : "No customers with a phone number yet."}
              </p>
            ) : (
              filtered.map((c) => {
                const on = !!selected[c.id];
                return (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition ${
                      on ? "border-indigo-200 bg-indigo-50/60" : "border-slate-100 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setSelected((prev) => ({ ...prev, [c.id]: !on }))}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{c.name || "—"}</span>
                    {(Number(c.balance) || 0) > 0 && (
                      <span className="shrink-0 inline-flex items-center rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
                        {fmtMoney(Number(c.balance) || 0)} due
                      </span>
                    )}
                    <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <Phone className="h-3 w-3" /> {normalizeWhatsAppNumber(c.phone) || c.phone}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-xs text-slate-400">
            {selectedCount} selected with phone · {queued} ready to send
            {selectedPendingTotal > 0 && <> · pending {fmtMoney(selectedPendingTotal)}</>}
          </p>
        </Card>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Batch size (per round)">
            <Input
              type="number"
              min="1"
              max="100"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
              disabled={inProgress}
              className="w-28"
            />
          </Field>
          <Field label="Gap between batches (minutes)">
            <Input
              type="number"
              min="0"
              max="120"
              value={gapMinutes}
              onChange={(e) => setGapMinutes(e.target.value)}
              disabled={inProgress}
              className="w-28"
            />
          </Field>
          <div className="ml-auto flex flex-wrap gap-2">
            {!inProgress ? (
              <Button onClick={startBroadcast} disabled={queued === 0}>
                <Play className="h-4 w-4" /> Start Broadcast
              </Button>
            ) : (
              <>
                {phase === "paused" ? (
                  <Button onClick={resumeBroadcast}>
                    <Play className="h-4 w-4" /> Resume
                  </Button>
                ) : (
                  <Button variant="soft" onClick={pauseBroadcast}>
                    <Pause className="h-4 w-4" /> Pause
                  </Button>
                )}
                {phase === "waiting" && (
                  <Button variant="soft" onClick={skipWait}>
                    <SkipForward className="h-4 w-4" /> Send next now
                  </Button>
                )}
                <Button variant="ghost" onClick={stopBroadcast} className="!text-rose-600 hover:!bg-rose-50">
                  <Square className="h-4 w-4" /> Stop
                </Button>
              </>
            )}
          </div>
        </div>

        {inProgress || phase === "done" || phase === "stopped" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="font-semibold text-slate-700">
                {phase === "waiting" ? (
                  <>
                    Batch {batchNo} of {totalBatches} sent · next batch in <Countdown until={waitingUntil} />
                  </>
                ) : phase === "done" ? (
                  <span className="text-emerald-600">Broadcast finished — {total} customer{total === 1 ? "" : "s"}.</span>
                ) : phase === "stopped" ? (
                  <span className="text-rose-600">Broadcast stopped.</span>
                ) : (
                  <>
                    {phase === "paused" ? "Paused" : "Sending"} — batch {batchNo} of {totalBatches}
                  </>
                )}
              </p>
              <p className="text-xs text-slate-400">
                {sent} of {total} sent
              </p>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
                style={{ width: `${total ? Math.round((sent / total) * 100) : 0}%` }}
              />
            </div>
            {current && (
              <p className="text-xs text-slate-500">
                Last opened: <span className="font-semibold text-slate-700">{current.name}</span>{" "}
                <span className="text-slate-400">({normalizeWhatsAppNumber(current.phone)})</span>
              </p>
            )}
          </div>
        ) : null}
      </Card>

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}