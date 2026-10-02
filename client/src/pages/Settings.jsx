import { useRef, useState } from "react";
import { Store, Save, Upload, Trash2, ImagePlus, CreditCard, Database, FileDown, FileSpreadsheet, FileUp } from "lucide-react";
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

  const [mode, setMode] = useState("replace");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);

  const setValue = (key, value) => {
    setInfo((i) => ({ ...i, [key]: value }));
    setSaved(false);
  };

  const set = (key) => (e) => setValue(key, e.target.value);

  const submit = (e) => {
    e.preventDefault();
    saveStoreInfo(info);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
              <Input value={info.phone || ""} onChange={set("phone")} placeholder="e.g. 0300 1234567" />
            </Field>
            <Field label="Tax / GST number">
              <Input value={info.taxNo || ""} onChange={set("taxNo")} placeholder="e.g. 07-1234567-8" />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Textarea value={info.address || ""} onChange={set("address")} placeholder="Shop address, city" />
            </Field>
          </div>

          {saved && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Settings saved</p>
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
              hint="Shown on receipts so customers can scan and pay."
              value={info.qrCode || ""}
              onChange={(v) => setValue("qrCode", v)}
            />
          </div>

          {saved && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Settings saved</p>
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
              <Input value={info.bankName || ""} onChange={set("bankName")} placeholder="e.g. Meezan Bank" />
            </Field>
            <Field label="Account number">
              <Input value={info.bankAccountNo || ""} onChange={set("bankAccountNo")} placeholder="e.g. 0201 2345 6789" />
            </Field>
            <Field label="IFSC / IBAN">
              <Input value={info.ifsc || ""} onChange={set("ifsc")} placeholder="e.g. PK36 SCBL 0000 0111 2345" />
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

          {saved && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Settings saved</p>
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