import { useState } from "react";
import { Store, Save } from "lucide-react";
import Card from "../components/Card.jsx";
import { Field, Input, Textarea, Button } from "../components/Field.jsx";
import { getStoreInfo, saveStoreInfo } from "../lib/storeInfo.js";

export default function Settings() {
  const [info, setInfo] = useState(getStoreInfo());
  const [saved, setSaved] = useState(false);

  const set = (key) => (e) => {
    setInfo((i) => ({ ...i, [key]: e.target.value }));
    setSaved(false);
  };

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
    </div>
  );
}