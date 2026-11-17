import { useEffect, useRef, useState } from "react";
import { Camera, ScanLine } from "lucide-react";
import BarcodeScanner from "./BarcodeScanner.jsx";
import { looksLikeScanCode } from "../lib/optionSearch.js";

// Hardware scanners type very fast, so we can tell them apart from a person
// typing by measuring the gap between keystrokes. If the whole code arrives in
// one burst (some scanners send no Enter/Tab suffix at all) we submit it once
// the input goes quiet instead of leaving the number sitting in the field.
const SCAN_MAX_GAP_MS = 250;
const SCAN_IDLE_MS = 350;
const SCAN_MIN_LENGTH = 4;

export default function BarcodeScanInput({
  onScan,
  disabled = false,
  placeholder = "Scan barcode and press Enter…",
  className = "",
  inputRef = null
}) {
  const [value, setValue] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const idleTimer = useRef(null);
  const lastKeyAt = useRef(0);
  const burstLength = useRef(0);

  const stopIdleTimer = () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  };

  useEffect(() => () => stopIdleTimer(), []);

  const submit = (code) => {
    const next = String(code || "").trim();
    if (!next) return;
    stopIdleTimer();
    lastKeyAt.current = 0;
    burstLength.current = 0;
    setValue("");
    onScan(next);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    const now = Date.now();
    const gap = now - lastKeyAt.current;
    const inserted = Math.max(0, next.length - value.length);
    lastKeyAt.current = now;

    if (inserted <= 0) {
      burstLength.current = 0;
    } else if (gap <= SCAN_MAX_GAP_MS) {
      burstLength.current += inserted;
    } else {
      burstLength.current = inserted >= SCAN_MIN_LENGTH ? inserted : 1;
    }

    setValue(next);
    stopIdleTimer();

    if (
      burstLength.current >= SCAN_MIN_LENGTH &&
      looksLikeScanCode(next)
    ) {
      idleTimer.current = setTimeout(() => submit(next), SCAN_IDLE_MS);
    }
  };

  return (
    <>
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-500" />
          <input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                submit(value);
              }
            }}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            inputMode="text"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 font-mono text-sm outline-none transition placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          disabled={disabled}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
          aria-label="Scan barcode with camera"
          title="Scan barcode with camera"
        >
          <Camera className="h-4 w-4" />
        </button>
      </div>
      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(code) => {
          setScannerOpen(false);
          submit(code);
        }}
      />
    </>
  );
}
