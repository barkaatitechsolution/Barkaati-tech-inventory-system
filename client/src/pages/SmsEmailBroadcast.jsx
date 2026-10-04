import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedState } from "../lib/useDebounced.js";
import {
  Megaphone,
  Search,
  Send,
  Play,
  Pause,
  Square,
  SkipForward,
  Phone,
  Mail,
  AtSign,
  Check,
  AlertTriangle,
  Copy,
  Ticket
} from "lucide-react";
import { api } from "../api.js";
import { useStoreInfo } from "../lib/storeInfo.js";
import {
  normalizePhone,
  isUsablePhone,
  isUsableEmail,
  openSmsApp,
  openMailApp,
  smsParts,
  mailtoLength,
  MAILTO_SAFE_CHARS,
  SMS_SINGLE_LIMIT
} from "../lib/messaging.js";
import { fmtMoney } from "../lib/format.js";
import Card from "../components/Card.jsx";
import Countdown from "../components/Countdown.jsx";
import { Field, Input, Button } from "../components/Field.jsx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Both channels keep their own composed message. Switching tabs mid-compose is
// the normal way to check "how would this read as an SMS?", and losing the
// subject line every time would make that unbearable.
const EMPTY_DRAFT = { sms: { subject: "", body: "" }, email: { subject: "", body: "" } };

const CHANNELS = {
  sms: {
    label: "SMS",
    icon: Phone,
    // No subject line exists on an SMS, so it is not offered rather than offered
    // and silently dropped.
    hasSubject: false,
    blurb: "Goes out as a normal text message from this computer's or phone's messaging app."
  },
  email: {
    label: "Email",
    icon: Mail,
    hasSubject: true,
    blurb: "Goes out from your usual mail app, so it arrives from the address you already send from."
  }
};

// Every token the composer understands, shown in the field hint so the shopkeeper
// does not have to guess or read the source.
const TOKENS = "{name} · {phone} · {email} · {balance} · {store} · {voucher}";

const customerKey = (name) => String(name || "").trim().toLowerCase();

const fmtYmd = (s) => {
  if (!s) return "";
  const [y, m, d] = String(s).split("-");
  if (!y || !m || !d) return s;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] || ""} ${y}`;
};

const voucherLabel = (v) =>
  v.discount_type === "percent"
    ? `${Number(v.discount_value) || 0}% OFF`
    : `${fmtMoney(v.discount_value)} OFF`;

// Voucher details written as ordinary text.
//
// WhatsApp's version of this same block leans on *bold* and emoji to scan, but
// neither survives an SMS, and in an email they arrive as literal asterisks and
// mojibake. Plain sentences instead: the customer reads the same offer either
// way, and one wording serves both channels.
//
// The issued vouchers are passed in rather than read from state so this stays a
// plain function of its inputs.
const voucherDetailsFor = (issuedByCustomer, c) => {
  const list = issuedByCustomer[customerKey(c.name)] || [];
  if (list.length === 0) {
    return "(No active voucher yet — we will share one with you soon!)";
  }
  return list
    .map((v) => {
      const min = Number(v.min_total) || 0;
      const months = Number(v.months) || 0;
      const valid = fmtYmd(v.valid_through);
      const lines = [];
      lines.push(`Voucher ${v.code} — ${v.campaign_name || "discount voucher"}`);
      lines.push(
        `Get ${voucherLabel(v)}` +
          (min > 0 ? ` on a minimum purchase of ${fmtMoney(min)}` : "") +
          (months > 0 ? ` — valid ${months} month${months > 1 ? "s" : ""}, one use per month.` : ".")
      );
      if (valid) lines.push(`Valid till ${valid}`);
      lines.push("Show this code when you pay at our store.");
      return lines.join("\n");
    })
    .join("\n\n");
};

// Replaces every {token} in one pass. Applied after the message is assembled, so
// a name containing braces or a voucher line containing a comma cannot confuse
// the substitution order.
function fill(text, tokens) {
  let out = String(text || "");
  for (const [token, value] of Object.entries(tokens)) {
    out = out.replaceAll(token, value == null ? "" : String(value));
  }
  return out;
}

export default function SmsEmailBroadcast() {
  const store = useStoreInfo();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState("sms");
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [autoPersonalize, setAutoPersonalize] = useState(true);
  const [search, setSearch, debouncedSearch] = useDebouncedState("");
  const [filter, setFilter] = useState("all"); // all | credit | non-credit
  // One selection per channel: a customer can be ticked for the SMS run and left
  // alone for the email one, and switching tabs never disturbs either list.
  const [selSms, setSelSms] = useState({});
  const [selEmail, setSelEmail] = useState({});
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
  const [voucherMode, setVoucherMode] = useState(false);
  const [voucherByCustomer, setVoucherByCustomer] = useState({});

  const selected = channel === "sms" ? selSms : selEmail;
  const setSelected = channel === "sms" ? setSelSms : setSelEmail;
  const { subject, body } = draft[channel];
  const meta = CHANNELS[channel];

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const c = await api.customers();
      setCustomers(c);
      // Start with everyone reachable on both channels ticked, and anyone missing
      // a number or an address left alone -- an unticked customer is far easier
      // to notice than a ticked one that can never be reached.
      const sms = {};
      const email = {};
      c.forEach((x) => {
        if (isUsablePhone(x.phone)) sms[x.id] = true;
        if (isUsableEmail(x.email)) email[x.id] = true;
      });
      setSelSms(sms);
      setSelEmail(email);
    } catch (e) {
      setToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Leaving the page must stop the send loop. runLoop only exits when
  // ctrl.active flips to false, and stopBroadcast is a click handler -- so
  // without this an in-flight broadcast keeps opening windows and writing state
  // to an unmounted component until the queue drains.
  useEffect(
    () => () => {
      if (controller.current) controller.current.active = false;
    },
    []
  );

  const hasContact = (c) => (channel === "sms" ? isUsablePhone(c.phone) : isUsableEmail(c.email));

  const contactOf = (c) => (channel === "sms" ? normalizePhone(c.phone) : String(c.email || "").trim());

  const eligible = useMemo(() => customers.filter(hasContact), [customers, channel]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return eligible.filter((c) => {
      const bal = Number(c.balance) || 0;
      if (filter === "credit" && bal <= 0) return false;
      if (filter === "non-credit" && bal > 0) return false;
      if (q && ![c.name, c.phone, c.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))) {
        return false;
      }
      return true;
    });
  }, [eligible, debouncedSearch, filter]);

  // ── Composing ──────────────────────────────────────────────

  const tokensFor = (c) => {
    const bal = Number(c.balance) || 0;
    return {
      "{name}": c.name || "",
      // On SMS the number has to be diallable, so it goes in international form;
      // on email it is only ever read, so the number as typed is friendlier.
      "{phone}": channel === "sms" ? normalizePhone(c.phone) || c.phone || "" : c.phone || "",
      "{email}": c.email || "",
      "{balance}": fmtMoney(bal),
      "{store}": store.name || "",
      "{voucher}": voucherMode ? voucherDetailsFor(voucherByCustomer, c) : "{voucher}"
    };
  };

  const renderFor = (c) => {
    const bal = Number(c.balance) || 0;
    const tokens = tokensFor(c);

    const hasName = body.includes("{name}");
    const hasBalance = body.includes("{balance}");

    const parts = [];
    if (autoPersonalize && !hasName && c.name) parts.push(`Dear ${c.name},`);
    if (body.trim()) parts.push(body.trim());
    if (autoPersonalize && bal > 0 && !hasBalance) {
      parts.push(`You have a pending bill of ${fmtMoney(bal)} with us. Kindly settle it at your earliest convenience.`);
    }

    return {
      text: fill(parts.join("\n\n"), tokens).trim(),
      subject: fill(subject.trim(), tokens).trim()
    };
  };

  const setField = (field, value) =>
    setDraft((prev) => ({ ...prev, [channel]: { ...prev[channel], [field]: value } }));

  const previewCustomer = useMemo(
    () => eligible.find((c) => selected[c.id]),
    [eligible, selected]
  );
  // Vouchers arrive after the first render, so they belong in the dependencies:
  // without them the preview would keep showing an unresolved {voucher} until
  // something else happened to re-render it.
  const preview = useMemo(
    () => (previewCustomer ? renderFor(previewCustomer) : null),
    [previewCustomer, subject, body, autoPersonalize, voucherMode, voucherByCustomer, store.name, channel]
  );

  // ── Recipient selection ────────────────────────────────────

  const toggleSelectAllFor = (on) => {
    setSelected((prev) => {
      const next = { ...prev };
      filtered.forEach((c) => {
        if (on) next[c.id] = true;
        else delete next[c.id];
      });
      return next;
    });
  };

  const selectPending = () => {
    const next = {};
    customers.forEach((c) => {
      if (hasContact(c) && (Number(c.balance) || 0) > 0) next[c.id] = true;
    });
    setSelected(next);
    setToast(
      `${Object.keys(next).length} customer${Object.keys(next).length === 1 ? "" : "s"} with pending bills selected`
    );
  };

  const loadVouchers = async () => {
    const byCust = {};
    try {
      const vs = await api.vouchers("status=issued");
      vs.forEach((v) => {
        const k = customerKey(v.customer_name);
        if (!k) return;
        (byCust[k] = byCust[k] || []).push(v);
      });
    } catch {
      /* keep whatever we had */
    }
    setVoucherByCustomer(byCust);
    return byCust;
  };

  const selectVoucherHolders = async () => {
    const byCust = Object.keys(voucherByCustomer).length ? voucherByCustomer : await loadVouchers();
    const holders = new Set(Object.keys(byCust));
    let picked = 0;
    setSelected((prev) => {
      const next = { ...prev };
      customers.forEach((c) => {
        const has = holders.has(customerKey(c.name)) && hasContact(c);
        if (has) picked++;
        next[c.id] = has;
      });
      return next;
    });
    setToast(`${picked} voucher holder${picked === 1 ? "" : "s"} selected`);
  };

  const toggleVoucherMode = async () => {
    if (voucherMode) {
      setVoucherMode(false);
      setToast("Voucher details off — message is back to normal");
      return;
    }
    const byCust = await loadVouchers();
    setVoucherMode(true);
    setDraft((prev) => ({
      ...prev,
      [channel]: {
        subject: channel === "email" ? "Your voucher inside" : prev[channel].subject,
        body:
          "Hello {name},\n\nWe have created a voucher for you. Here are your details:\n\n{voucher}\n\nShow the code at our store when paying — your discount is applied automatically each month.\n\n{store}"
      }
    }));
    setSelected((prev) => {
      const next = { ...prev };
      customers.forEach((c) => {
        next[c.id] = !!byCust[customerKey(c.name)] && hasContact(c);
      });
      return next;
    });
    setToast("Voucher details on — each message includes that customer's own code");
  };

  // ── Templates ──────────────────────────────────────────────

  const applyTemplate = (name) => {
    const templates = {
      reminder: {
        subject: "Payment Reminder",
        body:
          "Hello {name},\n\nThis is a friendly reminder that you have a pending bill of {balance} with us.\n\nKindly settle it at your earliest convenience.\n\nThank you!\n{store}"
      },
      offer: {
        subject: "A special offer for you",
        body: "Hello {name},\n\nWe have a special offer today — flat 15% off on all items!\n\nVisit {store} before stock runs out."
      },
      thanks: {
        subject: "Thank you for shopping with us",
        body: "Hello {name},\n\nThank you for shopping at {store} today. We would love to see you again!\n\nDo reply to this message if you need anything."
      }
    };
    const t = templates[name];
    setDraft((prev) => ({ ...prev, [channel]: { subject: t.subject, body: t.body } }));
    setToast(name === "reminder" ? "{balance} will show each customer's pending amount" : "Template applied");
  };

  // ── Sending ────────────────────────────────────────────────

  const buildQueue = () =>
    eligible
      .filter((c) => selected[c.id])
      .map((c) => ({ customer: c, ...renderFor(c) }));

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

  // Every message lands on the clipboard before its window opens. It costs
  // nothing and it is the escape hatch for the two things these links cannot do:
  // a mail client that ignores a pre-filled body, and a message the client
  // silently trimmed.
  const openFor = (item, ch) => {
    copyToClipboard(item.text);
    if (ch === "sms") openSmsApp(item.text, item.customer.phone);
    else openMailApp({ to: item.customer.email, subject: item.subject, body: item.text });
  };

  const runLoop = async (q, size, gapMs, ch) => {
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
        openFor(q[j], ch);
        setCurrent(q[j].customer);
        setSent(j + 1);
        if (j < end - 1) await sleep(2500);
      }
      i = end;
      if (i < q.length && ctrl.active && gapMs > 0) {
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
    setPhase(ctrl.active ? "done" : "stopped");
    controller.current = null;
  };

  const startBroadcast = () => {
    const q = buildQueue();
    if (q.length === 0) {
      setToast(`No customers selected with a valid ${channel === "sms" ? "phone number" : "email address"}`);
      return;
    }
    setTotal(q.length);
    setSent(0);
    setCurrent(null);
    // The channel is captured on the controller rather than read from state, so
    // switching tabs part-way through a run cannot redirect the remaining
    // messages down the other channel.
    const ctrl = { active: true, paused: false };
    controller.current = ctrl;
    setPhase("running");
    const size = Math.min(100, Math.max(1, Number(batchSize) || 1));
    const gapMs = Math.max(0, Number(gapMinutes) || 0) * 60000;
    runLoop(q, size, gapMs, channel).catch(() => {
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
    if (!previewCustomer) {
      setToast(`Select a customer with a valid ${channel === "sms" ? "phone number" : "email address"} first`);
      return;
    }
    openFor({ customer: previewCustomer, ...renderFor(previewCustomer) }, channel);
  };

  const copyMessage = () => {
    if (!preview) return;
    copyToClipboard(preview.text);
    setToast("Message copied");
  };

  // ── Derived numbers for the footer ─────────────────────────

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const queued = useMemo(() => eligible.filter((c) => selected[c.id]).length, [eligible, selected]);
  const selectedPendingTotal = useMemo(
    () =>
      eligible
        .filter((c) => selected[c.id])
        .reduce((a, c) => a + (Number(c.balance) || 0), 0),
    [eligible, selected]
  );
  const pendingAllTotal = useMemo(
    () => customers.filter((c) => hasContact(c) && (Number(c.balance) || 0) > 0).reduce((a, c) => a + (Number(c.balance) || 0), 0),
    [customers, channel]
  );

  const inProgress = phase === "running" || phase === "waiting" || phase === "paused";
  const size = Math.min(100, Math.max(1, Number(batchSize) || 1));
  const batchNo = total ? Math.min(Math.floor(sent / size) + 1, Math.ceil(total / size) || 1) : 0;
  const totalBatches = total ? Math.ceil(total / size) : 0;

  // Per-message cost warnings, worked out from the preview because that is the
  // message the shopkeeper is looking at while writing. With nobody selected
  // yet it falls back to the raw body, so the counter starts moving as soon as
  // there is something to measure rather than sitting blank at zero.
  const composed = preview ? preview.text : body;
  const parts = smsParts(composed);
  const mailLength = previewCustomer ? mailtoLength({ to: contactOf(previewCustomer), subject: preview.subject, body: preview.text }) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Megaphone className="h-6 w-6" />
          </div>
          <div>
            <p className="font-bold text-slate-900">SMS &amp; Email Broadcast</p>
            <p className="text-xs text-slate-500">
              Reach {eligible.length.toLocaleString("en-US")} customer
              {eligible.length === 1 ? "" : "s"} on {meta.label} — everyone else needs a{" "}
              {channel === "sms" ? "phone number" : "email address"} on file first
            </p>
          </div>
        </div>

        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
          {Object.entries(CHANNELS).map(([key, ch]) => {
            const Icon = ch.icon;
            const on = channel === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setChannel(key)}
                disabled={inProgress}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${
                  on ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {ch.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          {channel === "sms" ? (
            <>
              Each message opens the recipient in your phone or computer&apos;s messaging app with the text already
              filled in — press <b>Send</b> in each window. It goes out from your own number and SIM, so there is no
              gateway, no account and no per-message charge to set up. The text is copied to your clipboard just
          before the window opens, so press <b>Paste (Ctrl+V)</b> if the app did not fill it in. Allow pop-ups for this
              site, and note that anything past {SMS_SINGLE_LIMIT} characters is sent as several messages and billed
              by your operator accordingly.
            </>
          ) : (
            <>
              Each message opens your usual mail app with the recipient, subject and body filled in — press <b>Send</b> in
              each window. It leaves from the address you already send from, so nothing is routed through a third party
              and no customer list is uploaded anywhere. The text is copied to your clipboard just before the window
              opens, so press <b>Paste (Ctrl+V)</b> if your mail app did not carry the body over.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-4">
          <p className="text-sm font-bold text-slate-800">{meta.label} message</p>

          {meta.hasSubject && (
            <Field
              label="Subject"
              hint={`Optional heading. Placeholders: ${TOKENS}`}
            >
              <Input
                value={subject}
                onChange={(e) => setField("subject", e.target.value)}
                placeholder="e.g. Diwali Special 20% OFF"
              />
            </Field>
          )}

          <Field
            label="Message"
            hint={`Placeholders: ${TOKENS} — all replaced per customer`}
          >
            <textarea
              value={body}
              onChange={(e) => setField("body", e.target.value)}
              rows={6}
              placeholder={
                channel === "sms"
                  ? "Hello {name}, we have a special offer today — flat 15% off on all items! Visit {store} before stock runs out."
                  : "Hello {name},\n\nWe have a special offer today — flat 15% off on all items!\n\nVisit {store} before stock runs out."
              }
              className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </Field>

          {channel === "sms" ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-slate-400">{composed.length.toLocaleString("en-US")} characters</span>
              <span className="text-slate-300">·</span>
              <span className={parts > 1 ? "font-semibold text-amber-600" : "text-slate-400"}>
                {parts} SMS part{parts === 1 ? "" : "s"}
                {parts > 1 ? " — your operator bills each part" : ""}
              </span>
            </div>
          ) : (
            mailLength > MAILTO_SAFE_CHARS && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  This message is {mailLength.toLocaleString("en-US")} characters long. Mail apps often cut a pre-filled
                  email off around {MAILTO_SAFE_CHARS.toLocaleString("en-US")} characters without saying so — send this
                  one from your mail app instead, or shorten it.
                </p>
              </div>
            )
          )}

          <label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={autoPersonalize}
              onChange={(e) => setAutoPersonalize(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>
              Personalize each message automatically — adds <b>Dear{" "}<span className="font-mono">{`{name}`}</span></b>{" "}
              and the customer&apos;s pending-bill line when they owe money{" "}
              <span className="text-slate-400">(turns off if you use the tokens manually)</span>
            </span>
          </label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Live preview</p>
              <button
                type="button"
                onClick={copyMessage}
                disabled={!preview}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            {previewCustomer ? (
              <>
                {preview.subject && (
                  <p className="mb-1 border-b border-slate-200 pb-1 text-[13px] font-bold text-slate-800">
                    {preview.subject}
                  </p>
                )}
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{preview.text}</p>
                <p className="mt-1.5 text-[11px] text-slate-400">for {previewCustomer.name || "—"}</p>
              </>
            ) : (
              <p className="text-xs text-slate-400">No customer selected yet.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="soft" onClick={testMessage} disabled={!previewCustomer}>
              <Send className="h-4 w-4" /> Test on {meta.label}
            </Button>
            <Button variant="soft" onClick={() => applyTemplate("reminder")} className="!text-amber-700">
              <AlertTriangle className="h-4 w-4" /> Payment reminder
            </Button>
            <Button variant="soft" onClick={() => applyTemplate("offer")}>
              <Megaphone className="h-4 w-4" /> Offer
            </Button>
            <Button variant="soft" onClick={() => applyTemplate("thanks")}>
              <Check className="h-4 w-4" /> Thank you
            </Button>
            <Button
              variant={voucherMode ? "primary" : "soft"}
              onClick={toggleVoucherMode}
              className={!voucherMode ? "!text-violet-700" : ""}
            >
              <Ticket className="h-4 w-4" /> Voucher details
            </Button>
          </div>

          {voucherMode && (
            <p className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-700">
              Voucher mode is on — each message includes that customer&apos;s own issued voucher code, the discount and
              its validity. Customers without one get a friendly &quot;no voucher yet&quot; line.
            </p>
          )}
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
            <Button type="button" variant="soft" className="!px-2 !py-1 text-xs !text-violet-700" onClick={selectVoucherHolders}>
              <Ticket className="h-3 w-3" /> Voucher holders
            </Button>
          </div>
          <p className="text-[11px] text-slate-400">
            Only customers with a valid {channel === "sms" ? "phone number" : "email address"} are listed — add one in
            the Customers page to reach them. &quot;Pending bills&quot; selects everyone who owes money (
            {fmtMoney(pendingAllTotal)} in total).
          </p>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers by name, phone or email…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="h-64 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {loading ? (
              <p className="py-8 text-center text-xs text-slate-400">Loading customers…</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                {search
                  ? "No matching customers."
                  : `No customers with a valid ${channel === "sms" ? "phone number" : "email address"} yet.`}
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
                      {channel === "sms" ? (
                        <>
                          <Phone className="h-3 w-3" /> {normalizePhone(c.phone)}
                        </>
                      ) : (
                        <>
                          <AtSign className="h-3 w-3" /> {c.email}
                        </>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-xs text-slate-400">
            {selectedCount} selected · {queued} ready to send on {meta.label}
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
                <Play className="h-4 w-4" /> Start {meta.label} Broadcast
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
                  <span className="text-emerald-600">
                    Broadcast finished — {total} customer{total === 1 ? "" : "s"}.
                  </span>
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
                <span className="text-slate-400">({contactOf(current)})</span>
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