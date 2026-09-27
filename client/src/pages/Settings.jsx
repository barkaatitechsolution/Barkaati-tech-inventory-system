import { useRef, useState } from "react";
import { Store, Save, Upload, Trash2, ImagePlus, CreditCard, Database, FileDown, FileSpreadsheet } from "lucide-react";
import Card from "../components/Card.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import { getStoreInfo, saveStoreInfo } from "../lib/storeInfo.js";

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
        </div>
      </Card>
    </div>
  );
}