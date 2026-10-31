import { useEffect, useRef, useState } from "react";
import { Store, Save, Upload, Trash2, ImagePlus, CreditCard, Database, FileDown, FileSpreadsheet, FileUp, Lock, ShieldCheck, ShoppingBag } from "lucide-react";
import Card from "../components/Card.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import { getStoreInfo, saveStoreInfo } from "../lib/storeInfo.js";
import { api } from "../api.js";

function download(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function todayString() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function resizeImage(file, done) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 512;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const scale = MAX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      done(canvas.toDataURL("image/png"));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function ImageUpload({ label, hint, value, onChange }) {
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    resizeImage(file, onChange);
    e.target.value = "";
  };

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-4">
        {value ? (
                <img
                  src={value}
                  alt={label}
                  decoding="async"
                  className="h-20 w-20 rounded-xl border border-slate-200 bg-white object-contain p-1.5"
                />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400">
            <ImagePlus className="h-7 w-7" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />
          <Button type="button" variant="ghost" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> {value ? "Change image" : "Upload"}
          </Button>
          {value && (
            <Button type="button" variant="danger" onClick={() => onChange("")}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          )}
        </div>
      </div>
    </Field>
  );
}

export default function Settings() {
  const [info, setInfo] = useState(getStoreInfo());
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [security, setSecurity] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityMsg, setSecurityMsg] = useState(null);

  const [mode, setMode] = useState("replace");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);
  const savedTimer = useRef(null);

  // Same one-timer rule as the other pages: a second save must not be able to
  // be wiped early by the first one's timer, and the timer must not outlive
  // the page.
  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .securityStatus()
      .then((status) => {
        if (alive) setSecurity(status || { enabled: false, hasPassword: false });
      })
      .catch(() => {
        if (alive) setSecurity({ enabled: false, hasPassword: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  const setValue = (key, value) => {
    setInfo((i) => ({ ...i, [key]: value }));
    setSaved(false);
    setSaveError("");
  };

  const set = (key) => (e) => setValue(key, e.target.value);

  // Waits for the database write, so "Settings saved" can no longer appear for
  // a save that actually failed (server asleep, disk full, request too large).
  const submit = async (e) => {
    e.preventDefault();
    setSaveError("");
    try {
      await saveStoreInfo(info);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => {
        savedTimer.current = null;
        setSaved(false);
      }, 2000);
    } catch (err) {
      setSaveError(err?.message || "Could not save settings");
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setSecurityMsg(null);
    if (newPassword.length < 4) {
      setSecurityMsg({ type: "error", text: "Password must be at least 4 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setSecurityMsg({ type: "error", text: "The two passwords do not match." });
      return;
    }
    setSecurityBusy(true);
    try {
      const status = await api.setActionPassword({ currentPassword, newPassword });
      const next = status || { enabled: true, hasPassword: true };
      setSecurity(next);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSecurityMsg({
        type: "ok",
        text: next.enabled
          ? "Password saved. Editing and deleting records now requires it."
          : "Password saved. Protection is off; use the switch to turn it on."
      });
    } catch (err) {
      setSecurityMsg({ type: "error", text: err.message || "Could not save the password." });
    } finally {
      setSecurityBusy(false);
    }
  };

  const removePassword = async () => {
    setSecurityMsg(null);
    if (!currentPassword) {
      setSecurityMsg({ type: "error", text: "Enter the current password to remove protection." });
      return;
    }
    if (!window.confirm("Remove the saved password? Editing and deleting records will no longer ask for a password, and the switch will be off.")) {
      return;
    }
    setSecurityBusy(true);
    try {
      const status = await api.setActionPassword({ currentPassword, newPassword: "" });
      setSecurity(status || { enabled: false, hasPassword: false });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSecurityMsg({ type: "ok", text: "Password removed. Protection is off." });
    } catch (err) {
      setSecurityMsg({ type: "error", text: err.message || "Could not remove the password." });
    } finally {
      setSecurityBusy(false);
    }
  };

  const toggleProtection = async () => {
    if (security == null || securityBusy) return;
    setSecurityMsg(null);
    const turningOn = !security.enabled;
    if (turningOn && !security.hasPassword) {
      setSecurityMsg({ type: "error", text: "Set a password below to turn on protection." });
      return;
    }
    if (!currentPassword) {
      setSecurityMsg({ type: "error", text: "Enter the current password to change protection." });
      return;
    }
    setSecurityBusy(true);
    try {
      const status = await api.toggleSecurity({ enabled: turningOn, currentPassword });
      setSecurity((s) => ({ ...(s || {}), ...status }));
      setCurrentPassword("");
      setSecurityMsg({
        type: "ok",
        text: turningOn
          ? "Password protection turned on."
          : "Password protection turned off. Your password is saved for later."
      });
    } catch (err) {
      setSecurityMsg({ type: "error", text: err.message || "Could not change password protection." });
    } finally {
      setSecurityBusy(false);
    }
  };

  const resetImportState = () => {
    setPreview(null);
    setPreviewError(null);
    setError(null);
    setDone(null);
  };

  // Reading the file server-side first lets the user see what is in it, and
  // gives us the total row count used by the confirmation text.
  const pick = async (e) => {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    setFile(chosen);
    resetImportState();
    setBusy(true);
    try {
      setPreview(await api.inspectBackup(chosen));
    } catch (err) {
      setPreviewError(err.message);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!file || !preview) return;
    const label = mode === "replace" ? "replace all data" : "merge the file";
    const what =
      mode === "replace"
        ? "All current data in the tables in this file will be deleted."
        : "Rows whose ids already exist will be skipped.";
    if (!window.confirm(`About to ${label} with "${file.name}".\n\n${what}\n\nContinue?`)) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api.importBackup(file, mode));
      setFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Store information</h2>
            <p className="text-xs text-slate-500">Shown on printed sale receipts and the dashboard greeting</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Store name">
              <Input value={info.name || ""} onChange={set("name")} placeholder="e.g. Barkaati Store" />
            </Field>
            <Field label="Phone">
              <Input value={info.phone || ""} onChange={set("phone")} placeholder="e.g. +91 98765 43210" />
            </Field>
            <Field label="GST number">
              <Input value={info.taxNo || ""} onChange={set("taxNo")} placeholder="e.g. 22AAAAA0000A1Z5" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea value={info.address || ""} onChange={set("address")} placeholder="Shop address, city" />
            </Field>
          </div>

          {(saved || saveError) && (
            <p
              className={`rounded-xl px-3 py-2 text-sm ${
                saveError ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {saveError || "Settings saved"}
            </p>
          )}

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button type="submit">
              <Save className="h-4 w-4" /> Save Settings
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <ImagePlus className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Branding</h2>
            <p className="text-xs text-slate-500">Company logo and payment QR printed on receipts</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-5 sm:grid-cols-2">
            <ImageUpload
              label="Company logo"
              hint="Shown at the top of printed receipts. PNG/JPEG, resized automatically."
              value={info.logo || ""}
              onChange={(v) => setValue("logo", v)}
            />
            <ImageUpload
              label="Payment QR code"
              hint="Fallback QR shown when no UPI ID is set. A UPI ID makes each bill print its own amount-specific QR."
              value={info.qrCode || ""}
              onChange={(v) => setValue("qrCode", v)}
            />
          </div>

          {(saved || saveError) && (
            <p
              className={`rounded-xl px-3 py-2 text-sm ${
                saveError ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {saveError || "Settings saved"}
            </p>
          )}

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button type="submit">
              <Save className="h-4 w-4" /> Save Settings
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <CreditCard className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Bank & receipt footer</h2>
            <p className="text-xs text-slate-500">Bank transfer details and closing line printed on receipts</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account holder">
              <Input value={info.bankHolder || ""} onChange={set("bankHolder")} placeholder="e.g. Barkaati Store" />
            </Field>
            <Field label="Bank name">
              <Input value={info.bankName || ""} onChange={set("bankName")} placeholder="e.g. State Bank of India" />
            </Field>
            <Field label="Account number">
              <Input value={info.bankAccountNo || ""} onChange={set("bankAccountNo")} placeholder="e.g. 0201 2345 6789" />
            </Field>
            <Field label="IFSC code">
              <Input value={info.ifsc || ""} onChange={set("ifsc")} placeholder="e.g. SBIN0001234" />
            </Field>
            <Field label="UPI ID" hint="Bills print a QR code for each bill's due amount using this UPI ID.">
              <Input value={info.upiId || ""} onChange={set("upiId")} placeholder="e.g. barkaati@okhdfcbank" />
            </Field>
            <Field label="Receipt footer message" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={info.footerText || ""}
                onChange={set("footerText")}
                placeholder="e.g. THANK YOU! For queries, please contact us"
              />
            </Field>
          </div>

          {(saved || saveError) && (
            <p
              className={`rounded-xl px-3 py-2 text-sm ${
                saveError ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {saveError || "Settings saved"}
            </p>
          )}

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button type="submit">
              <Save className="h-4 w-4" /> Save Settings
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Online store</h2>
            <p className="text-xs text-slate-500">
              Shown to customers on the public storefront and its WhatsApp order message
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                info.onlineStoreEnabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {info.onlineStoreEnabled ? "Open" : "Closed"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={!!info.onlineStoreEnabled}
              aria-label="Toggle online store"
              onClick={() => setValue("onlineStoreEnabled", !info.onlineStoreEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                info.onlineStoreEnabled ? "bg-emerald-500" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  info.onlineStoreEnabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Store tagline" className="sm:col-span-2">
              <Input
                value={info.tagline || ""}
                onChange={set("tagline")}
                placeholder="e.g. Fresh groceries delivered to your door"
              />
            </Field>
            <Field
              label="WhatsApp number"
              hint="Orders open a chat with this number. India +91 is added automatically."
            >
              <Input
                value={info.whatsappNumber || ""}
                onChange={set("whatsappNumber")}
                placeholder="e.g. 98765 43210"
              />
            </Field>
            <Field label="Delivery fee (₹)" hint="Charged only on delivery orders, never on pickup.">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={info.deliveryFee ?? 0}
                onChange={set("deliveryFee")}
                placeholder="0"
              />
            </Field>
            <Field
              label="Public store URL"
              className="sm:col-span-2"
              hint="Paste your Cloudflare Tunnel address here so customers can find and share it."
            >
              <Input
                value={info.onlineStoreUrl || ""}
                onChange={set("onlineStoreUrl")}
                placeholder="e.g. https://store.yourdomain.com"
              />
            </Field>
          </div>

          {(saved || saveError) && (
            <p
              className={`rounded-xl px-3 py-2 text-sm ${
                saveError ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {saveError || "Settings saved"}
            </p>
          )}

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button type="submit">
              <Save className="h-4 w-4" /> Save Settings
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Lock className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Security</h2>
            <p className="text-xs text-slate-500">Require a password before editing or deleting records</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                security?.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {security == null ? "Checking…" : security.enabled ? "On" : "Off"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={!!security?.enabled}
              aria-label="Toggle password protection"
              onClick={toggleProtection}
              disabled={security == null || securityBusy}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                security?.enabled ? "bg-emerald-500" : "bg-slate-300"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  security?.enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        <form onSubmit={savePassword} className="mt-5 space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
            <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${security?.enabled ? "text-emerald-600" : "text-slate-400"}`} />
            <p className="text-xs text-slate-600">
              {security == null
                ? "Checking security settings…"
                : security.enabled
                  ? "Password protection is on. Every edit and delete will ask for this password."
                  : security.hasPassword
                    ? "Password protection is off. Your password is saved, so you can turn it back on anytime."
                    : "Set a password below to protect edits and deletes. Saving it turns protection on."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {security?.hasPassword && (
              <Field
                label="Current password"
                hint="Required to change the password, remove it, or use the switch."
                className="sm:col-span-2"
              >
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    setSecurityMsg(null);
                  }}
                  autoComplete="current-password"
                  placeholder="Enter the current password"
                />
              </Field>
            )}
            <Field
              label={security?.hasPassword ? "New password" : "Password"}
              hint="At least 4 characters. It is stored securely and cannot be recovered if forgotten."
            >
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setSecurityMsg(null);
                }}
                autoComplete="new-password"
                placeholder="Enter a password"
              />
            </Field>
            <Field label="Confirm password">
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setSecurityMsg(null);
                }}
                autoComplete="new-password"
                placeholder="Enter it again"
              />
            </Field>
          </div>

          {securityMsg && (
            <p
              className={`rounded-xl px-3 py-2 text-sm ${
                securityMsg.type === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {securityMsg.text}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
            {security?.hasPassword && (
              <Button type="button" variant="danger" disabled={securityBusy} onClick={removePassword}>
                <Trash2 className="h-4 w-4" /> Remove password
              </Button>
            )}
            <Button type="submit" disabled={securityBusy || security == null}>
              <Save className="h-4 w-4" />
              {securityBusy ? "Saving…" : security?.hasPassword ? "Change password" : "Set password"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Database className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Database backup</h2>
            <p className="text-xs text-slate-500">Download a copy of all your data</p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <p className="text-sm text-slate-600">
            The SQL file is a full backup you can restore into an empty database with{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">psql</code>. The Excel file
            has one sheet per table for easy viewing.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" variant="soft" onClick={() => download("/api/backup/sql", `storemanager-backup-${todayString()}.sql`)}>
              <FileDown className="h-4 w-4" /> Download SQL backup
            </Button>
            <Button type="button" variant="ghost" onClick={() => download("/api/backup/excel", `storemanager-data-${todayString()}.xlsx`)}>
              <FileSpreadsheet className="h-4 w-4" /> Download Excel backup
            </Button>
          </div>
          <p className="text-[11px] text-slate-400">
            Backups are generated live from the database and include every table (products, customers, suppliers,
            sales, expenses, assets, purchases and more).
          </p>

          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-800">Import from a backup file</h3>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Restore a <code className="rounded bg-slate-200 px-1 py-0.5">.sql</code> file created by
              &ldquo;Download SQL backup&rdquo;.
            </p>

            <div className="mt-4 space-y-2">
              {[
                {
                  value: "replace",
                  title: "Replace all data",
                  hint: "Deletes the current data and loads the file, making the database an exact copy of the backup.",
                },
                {
                  value: "merge",
                  title: "Merge into current data",
                  hint: "Keeps what is there now and adds only rows from the file whose ids are not already used.",
                }
              ].map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                    mode === opt.value
                      ? "border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="import-mode"
                    className="mt-0.5 h-4 w-4 accent-indigo-600"
                    checked={mode === opt.value}
                    onChange={() => {
                      setMode(opt.value);
                      setError(null);
                      setDone(null);
                    }}
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{opt.title}</span>
                    <span className="block text-xs text-slate-500">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".sql,text/plain,application/sql"
                className="hidden"
                onChange={pick}
              />
              <Button type="button" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
                <FileUp className="h-4 w-4" />
                {busy ? "Working…" : "Choose SQL file"}
              </Button>
              {file && (
                <>
                  <span className="max-w-[16rem] truncate text-xs text-slate-500" title={file.name}>
                    {file.name}
                  </span>
                  {preview ? (
                    <span className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                      {preview.totalRows.toLocaleString()} rows in {preview.tables.length} tables
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">{previewError ? "Not a valid backup" : "Reading…"}</span>
                  )}
                </>
              )}
            </div>

            {preview && preview.tables.length > 0 && (
              <details className="mt-3 rounded-xl bg-white p-3 text-xs text-slate-600">
                <summary className="cursor-pointer font-medium text-slate-700">
                  What&rsquo;s in this file ({preview.totalRows.toLocaleString()} rows)
                </summary>
                <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {preview.tables.map((t) => (
                    <li key={t.table} className="flex justify-between gap-3">
                      <span className="truncate">{t.table}</span>
                      <span className="font-medium tabular-nums text-slate-800">{t.rows.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {mode === "replace" && file && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                This deletes all current data. Download a backup first if you might need it.
              </p>
            )}

            {mode === "replace" && preview?.alsoClearedByReplace?.length > 0 && (
              <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-semibold">This file is incomplete &mdash; replace would also empty:</p>
                <p className="mt-1 break-words font-mono text-[11px]">{preview.alsoClearedByReplace.join(", ")}</p>
                <p className="mt-1">
                  Those tables hold rows linked to the ones in this file, and the file doesn&rsquo;t include them, so they
                  would be lost. Use a backup downloaded from this app, or switch to merge mode.
                </p>
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            )}

            {done && (
              <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <p className="font-semibold">
                  Import complete &mdash; {done.inserted.toLocaleString()} rows added
                  {done.skipped > 0 ? `, ${done.skipped.toLocaleString()} already existed` : ""}.
                </p>
                <p className="mt-0.5 text-xs text-emerald-700">
                  {done.mode === "replace" ? "Database replaced from the file." : "Merged into the existing data."}
                </p>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant={mode === "replace" ? "danger" : "primary"}
                disabled={!preview || busy}
                onClick={runImport}
              >
                <Upload className="h-4 w-4" />
                {mode === "replace" ? "Replace data with file" : "Merge file into database"}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}