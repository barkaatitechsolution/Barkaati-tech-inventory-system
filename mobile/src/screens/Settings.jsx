import { useEffect, useRef, useState } from "react";
import {
  Bluetooth,
  Cloud,
  Database,
  Download,
  Fingerprint,
  KeyRound,
  Link2,
  Lock,
  Printer,
  RefreshCw,
  Ruler,
  Save,
  Store,
  Tags,
  Upload
} from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { useAsync } from "../lib/useAsync.js";
import {
  biometricAvailable,
  changePin,
  disableBiometric,
  enableBiometric,
  hasBiometricEnabled,
  resetApp
} from "../lib/auth.js";
import { exportSqlFile, exportZipBackup, fileToBase64, fileToText, importZipBackup } from "../lib/backup.js";
import { importSqlBackup } from "../lib/sqlBackup.js";
import { listPrinters, testPrinter } from "../lib/printer.js";
import {
  disconnectSync,
  getSyncConfig,
  pairDevice,
  saveSyncServerUrl,
  startAutoSync,
  stopAutoSync,
  syncNow
} from "../lib/sync.js";
import {
  Button,
  Card,
  Confirm,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
  showToast
} from "../components/ui.jsx";

function Section({ icon: Icon, title, description, children }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {description ? <p className="text-[11px] text-slate-400">{description}</p> : null}
        </div>
      </div>
      {children}
    </Card>
  );
}

export default function Settings() {
  const { store, reloadStore, bump, lockApp, version } = useApp();
  const [form, setForm] = useState({
    name: "",
    address: "",
    phone: "",
    taxNo: "",
    footerText: "",
    upiId: "",
    printerAddress: ""
  });
  const [saving, setSaving] = useState(false);
  const [printers, setPrinters] = useState([]);
  const [testing, setTesting] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [sync, setSync] = useState(null);
  const [serverUrl, setServerUrl] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [deviceName, setDeviceName] = useState("Phone");
  const [syncBusy, setSyncBusy] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const sqlRef = useRef(null);
  const zipRef = useRef(null);
  const categories = useAsync(() => api.categories(), [version]);
  const units = useAsync(() => api.measuringUnits(), [version]);

  useEffect(() => {
    if (!store) return;
    setForm({
      name: store.name || "",
      address: store.address || "",
      phone: store.phone || "",
      taxNo: store.taxNo || "",
      footerText: store.footerText || "",
      upiId: store.upiId || "",
      printerAddress: store.printerAddress || ""
    });
  }, [store]);

  useEffect(() => {
    (async () => {
      setBioAvailable(await biometricAvailable());
      setBioEnabled(await hasBiometricEnabled());
    })();
  }, []);

  const loadSync = async () => {
    const cfg = await getSyncConfig();
    setSync(cfg);
    setServerUrl((current) => current || cfg.serverUrl || "");
    setDeviceName((current) => (current === "Phone" ? cfg.deviceName || "Phone" : current));
    return cfg;
  };

  useEffect(() => {
    loadSync().catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const saveStore = async () => {
    setSaving(true);
    try {
      await api.saveStoreInfo(form);
      await reloadStore();
      bump();
      showToast("Shop details saved");
    } catch (e) {
      showToast(e?.message || "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  const findPrinters = async () => {
    const list = await listPrinters();
    setPrinters(list);
    if (!list.length) {
      showToast("No paired printers found. Pair the printer in Android Bluetooth settings first.", "error");
    } else {
      showToast(`${list.length} paired device${list.length === 1 ? "" : "s"} found`, "info");
    }
  };

  const doTestPrint = async () => {
    setTesting(true);
    try {
      const via = await testPrinter({ ...store, ...form });
      showToast(`Test receipt sent (${via})`);
    } catch (e) {
      showToast(e?.message || "Could not print", "error");
    } finally {
      setTesting(false);
    }
  };

  const toggleBiometric = async (next) => {
    try {
      if (next) {
        await enableBiometric();
        setBioEnabled(true);
        showToast("Biometric unlock enabled");
      } else {
        await disableBiometric();
        setBioEnabled(false);
        showToast("Biometric unlock disabled");
      }
    } catch (e) {
      showToast(e?.message || "Could not change biometric setting", "error");
    }
  };

  const savePin = async () => {
    setPinBusy(true);
    try {
      await changePin(oldPin, newPin);
      setPinOpen(false);
      setOldPin("");
      setNewPin("");
      showToast("PIN changed");
    } catch (e) {
      showToast(e?.message || "Could not change PIN", "error");
    } finally {
      setPinBusy(false);
    }
  };

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    try {
      await api.createCategory({ name: newCategory.trim() });
      setNewCategory("");
      categories.reload();
      bump();
      showToast("Category added");
    } catch (e) {
      showToast(e?.message || "Could not add category", "error");
    }
  };

  const addUnit = async () => {
    if (!newUnit.trim()) return;
    try {
      await api.createMeasuringUnit({
        name: newUnit.trim(),
        short_name: newUnit.trim().slice(0, 4),
        category: "count",
        conversion_factor: 1
      });
      setNewUnit("");
      units.reload();
      bump();
      showToast("Unit added");
    } catch (e) {
      showToast(e?.message || "Could not add unit", "error");
    }
  };

  const exportZip = async () => {
    setBusy("zip-export");
    try {
      const res = await exportZipBackup();
      showToast(`Backup ready (${res.files} files)`);
    } catch (e) {
      showToast(e?.message || "Backup failed", "error");
    } finally {
      setBusy("");
    }
  };

  const exportSql = async () => {
    setBusy("sql-export");
    try {
      await exportSqlFile();
      showToast("SQL backup ready");
    } catch (e) {
      showToast(e?.message || "Backup failed", "error");
    } finally {
      setBusy("");
    }
  };

  const choose = async (type, file) => {
    if (!file) return;
    if (type === "sql") {
      const sql = await fileToText(file);
      setPending({ type, sql, name: file.name });
    } else {
      const base64 = await fileToBase64(file);
      setPending({ type, base64, name: file.name });
    }
  };

  const runImport = async () => {
    if (!pending) return;
    setBusy("import");
    try {
      if (pending.type === "sql") {
        const res = await importSqlBackup(pending.sql);
        showToast(`Imported ${res.totalRows} rows`);
      } else {
        const res = await importZipBackup(pending.base64);
        showToast(`Restored ${res.rows} rows and ${res.files} files`);
      }
      setPending(null);
      await reloadStore();
      bump();
    } catch (e) {
      showToast(e?.message || "Import failed", "error");
    } finally {
      setBusy("");
    }
  };

  const pair = async () => {
    if (!pairCode.trim()) {
      showToast("Enter the pairing code from the web app", "error");
      return;
    }
    setSyncBusy("pair");
    try {
      await saveSyncServerUrl(serverUrl);
      const data = await pairDevice({ serverUrl, code: pairCode, deviceName });
      setPairCode("");
      await loadSync();
      stopAutoSync();
      await startAutoSync();
      showToast(`Paired as ${data.prefix}. Download the web data next.`);
    } catch (e) {
      showToast(e?.message || "Could not pair", "error");
    } finally {
      setSyncBusy("");
    }
  };

  const runSync = async () => {
    setSyncBusy("sync");
    try {
      await syncNow();
      await loadSync();
      await reloadStore();
      bump();
      showToast("Sync complete");
    } catch (e) {
      await loadSync();
      showToast(e?.message || "Sync failed", "error");
    } finally {
      setSyncBusy("");
    }
  };

  const replaceFromWeb = async () => {
    setReplaceOpen(false);
    setSyncBusy("replace");
    try {
      await syncNow({ replace: true, backupFirst: true });
      await loadSync();
      await reloadStore();
      bump();
      showToast("Web data downloaded");
    } catch (e) {
      await loadSync();
      showToast(e?.message || "Download failed", "error");
    } finally {
      setSyncBusy("");
    }
  };

  const unpair = async () => {
    await disconnectSync();
    await loadSync();
    showToast("This phone is disconnected");
  };

  const erase = async () => {
    await resetApp();
    window.location.reload();
  };

  return (
    <div className="pb-24">
      <PageHeader title="Settings" subtitle="Store, printing, security and backup" />

      <div className="space-y-3 px-4">
        <Section icon={Store} title="Shop details" description="Shown on receipts and invoices">
          <Field label="Shop name"><Input value={form.name} onChange={set("name")} /></Field>
          <Field label="Address"><Textarea value={form.address} onChange={set("address")} rows={2} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone"><Input value={form.phone} onChange={set("phone")} inputMode="tel" /></Field>
            <Field label="GST / Tax no."><Input value={form.taxNo} onChange={set("taxNo")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="UPI ID"><Input value={form.upiId} onChange={set("upiId")} placeholder="shop@upi" /></Field>
            <Field label="Footer text"><Input value={form.footerText} onChange={set("footerText")} placeholder="Thank you!" /></Field>
          </div>
          <Button className="w-full" loading={saving} onClick={saveStore}>
            <Save className="h-4 w-4" /> Save shop details
          </Button>
        </Section>

        <Section icon={Printer} title="Receipt printer" description="58mm ESC/POS over Bluetooth">
          <Field label="Printer address">
            <Input
              value={form.printerAddress}
              onChange={set("printerAddress")}
              placeholder="e.g. 66:22:AA:BB:CC:DD"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={findPrinters}>
              <Bluetooth className="h-4 w-4" /> Find paired
            </Button>
            <Button variant="secondary" loading={testing} onClick={doTestPrint}>
              Test print
            </Button>
          </div>
          {printers.length ? (
            <div className="space-y-1">
              {printers.map((p) => (
                <button
                  key={p.address}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, printerAddress: p.address }))}
                  className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-left text-xs"
                >
                  <span className="font-semibold text-slate-700">{p.name}</span>
                  <span className="font-mono text-slate-400">{p.address}</span>
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-[11px] text-slate-400">
            Pair the printer in Android Bluetooth settings first. Classic SPP needs the bridge described in BUILD.md;
            BLE printers are detected in-app.
          </p>
        </Section>

        <Section icon={Lock} title="App lock" description="PIN and biometrics protect the data">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-slate-500" />
              <div>
                <p className="text-sm font-medium text-slate-700">Fingerprint / face unlock</p>
                <p className="text-[11px] text-slate-400">
                  {bioAvailable ? "Available on this device" : "Not available on this device"}
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={bioEnabled}
              disabled={!bioAvailable}
              onChange={(e) => toggleBiometric(e.target.checked)}
              className="h-5 w-5 accent-brand-700"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setPinOpen(true)}>
              <KeyRound className="h-4 w-4" /> Change PIN
            </Button>
            <Button variant="secondary" onClick={lockApp}>
              <Lock className="h-4 w-4" /> Lock now
            </Button>
          </div>
        </Section>

        <Section icon={Tags} title="Catalog" description="Categories and units used by products">
          <div className="flex gap-2">
            <Input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="New category name"
            />
            <Button variant="secondary" onClick={addCategory}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(categories.data || []).map((c) => (
              <span key={c.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {c.name}
              </span>
            ))}
            {!categories.data?.length ? (
              <span className="text-[11px] text-slate-400">No categories yet.</span>
            ) : null}
          </div>
          <div className="flex gap-2 border-t border-slate-100 pt-3">
            <Input
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              placeholder="New unit (e.g. kg, pcs)"
            />
            <Button variant="secondary" onClick={addUnit}>
              <Ruler className="h-4 w-4" /> Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(units.data || []).map((u) => (
              <span key={u.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {u.name}
              </span>
            ))}
            {!units.data?.length ? (
              <span className="text-[11px] text-slate-400">No units yet.</span>
            ) : null}
          </div>
        </Section>

        <Section icon={Cloud} title="Sync with web" description="Two-way sync between this phone and the shop server">
          {sync?.token ? (
            <div className="space-y-2.5">
              <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-700">Connected</span>
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 font-mono text-[10px] font-bold text-brand-800">
                    {sync.prefix || "?"}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{sync.serverUrl}</p>
                <div className="mt-2 flex justify-between gap-2 text-[11px]">
                  <span>{sync.pending} change{sync.pending === 1 ? "" : "s"} waiting</span>
                  <span>{sync.lastAt ? `Last ${sync.lastAt}` : "Not synced yet"}</span>
                </div>
                {sync.lastError ? (
                  <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{sync.lastError}</p>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button loading={syncBusy === "sync"} onClick={runSync}>
                  <RefreshCw className="h-4 w-4" /> Sync now
                </Button>
                <Button variant="outline" loading={syncBusy === "replace"} onClick={() => setReplaceOpen(true)}>
                  <Download className="h-4 w-4" /> Download web
                </Button>
              </div>
              {!sync.initialized ? (
                <p className="text-[11px] text-amber-700">
                  Tap “Download web” once to copy the shop data to this phone. A local backup is made first.
                </p>
              ) : null}
              <Button variant="ghost" className="w-full" onClick={unpair}>
                Disconnect this phone
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <Field label="Shop server address">
                <Input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.10:3001"
                  autoCapitalize="none"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Pairing code">
                  <Input
                    value={pairCode}
                    onChange={(e) => setPairCode(e.target.value.toUpperCase())}
                    placeholder="ABC-123"
                    autoCapitalize="characters"
                  />
                </Field>
                <Field label="Device name">
                  <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
                </Field>
              </div>
              <Button className="w-full" loading={syncBusy === "pair"} onClick={pair}>
                <Link2 className="h-4 w-4" /> Pair this phone
              </Button>
              <p className="text-[11px] text-slate-400">
                Get a one-time code from the web app: Settings → Sync devices.
              </p>
            </div>
          )}
        </Section>

        <Section icon={Database} title="Backup & restore" description="Keep a copy off the device">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" loading={busy === "zip-export"} onClick={exportZip}>
              <Download className="h-4 w-4" /> ZIP backup
            </Button>
            <Button variant="outline" loading={busy === "sql-export"} onClick={exportSql}>
              <Download className="h-4 w-4" /> SQL backup
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => sqlRef.current?.click()}>
              <Upload className="h-4 w-4" /> Import SQL
            </Button>
            <Button variant="secondary" onClick={() => zipRef.current?.click()}>
              <Upload className="h-4 w-4" /> Import ZIP
            </Button>
          </div>
          <input
            ref={sqlRef}
            type="file"
            accept=".sql,text/plain"
            className="hidden"
            onChange={(e) => { choose("sql", e.target.files?.[0]); e.target.value = ""; }}
          />
          <input
            ref={zipRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => { choose("zip", e.target.files?.[0]); e.target.value = ""; }}
          />
          <p className="text-[11px] text-slate-400">
            Importing replaces everything currently on this device. Export a backup first. ZIP backups include product
            photos and documents.
          </p>
          <Button variant="danger" onClick={() => setResetOpen(true)}>
            Erase all data
          </Button>
        </Section>

        <Card>
          <p className="text-center text-[11px] text-slate-400">
            Barkaati Inventory · Offline edition
            <br />
            Data never leaves this device unless you export it.
          </p>
        </Card>
      </div>

      <Modal
        open={pinOpen}
        title="Change PIN"
        onClose={() => setPinOpen(false)}
        footer={<Button className="w-full" loading={pinBusy} onClick={savePin}>Change PIN</Button>}
      >
        <div className="space-y-3">
          <Field label="Current PIN">
            <Input value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" />
          </Field>
          <Field label="New 6-digit PIN">
            <Input value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={!!pending}
        title={pending?.type === "sql" ? "Import SQL backup?" : "Restore ZIP backup?"}
        message={
          pending
            ? `"${pending.name}" will replace all data on this device. This cannot be undone.`
            : ""
        }
        confirmLabel={busy === "import" ? "Importing…" : "Replace data"}
        onClose={() => (busy === "import" ? null : setPending(null))}
        onConfirm={runImport}
      />

      <Confirm
        open={replaceOpen}
        title="Download web data?"
        message="This replaces everything on this phone with the shop server data. A SQL backup is saved first."
        confirmLabel={syncBusy === "replace" ? "Downloading…" : "Download & replace"}
        onClose={() => (syncBusy === "replace" ? null : setReplaceOpen(false))}
        onConfirm={replaceFromWeb}
      />

      <Confirm
        open={resetOpen}
        title="Erase all data?"
        message="The encrypted database, PIN and all photos will be deleted from this device. There is no undo."
        confirmLabel="Erase everything"
        onClose={() => setResetOpen(false)}
        onConfirm={erase}
      />

      {busy === "import" ? (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-slate-900/60 text-white">
          <Spinner className="h-7 w-7" />
          <p className="text-sm font-medium">Restoring backup…</p>
        </div>
      ) : null}
    </div>
  );
}
