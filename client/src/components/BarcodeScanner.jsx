import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, ScanLine } from "lucide-react";
import Modal from "./Modal.jsx";
import { Field, Input, Button } from "./Field.jsx";

function friendlyCameraError(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied. Allow camera access, or use “Take photo” below.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this device. Use “Take photo” below.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is busy in another app. Close it and try again.";
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Live camera needs HTTPS on phones. Use “Take photo” below to scan without it.";
  }
  return error?.message || "Could not start the camera.";
}

export default function BarcodeScanner({
  open,
  onClose,
  onDetected,
  title = "Scan barcode",
  subtitle = "Point the camera at a product barcode"
}) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const detectedRef = useRef(onDetected);
  const doneRef = useRef(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [decoding, setDecoding] = useState(false);

  useEffect(() => {
    detectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return;
    setManual("");
    setError(null);
    doneRef.current = false;
    let cancelled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Live camera is not available here. Use “Take photo” below.");
        return;
      }
      setStarting(true);
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result, _err, cbControls) => {
            if (!result || doneRef.current) return;
            doneRef.current = true;
            cbControls?.stop();
            const value = String(result.getText() || "").trim();
            if (value) detectedRef.current(value);
          }
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setStarting(false);
      } catch (e) {
        if (cancelled) return;
        setStarting(false);
        setError(friendlyCameraError(e));
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open]);

  const onPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setDecoding(true);
    setError(null);
    const url = URL.createObjectURL(file);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(url);
      const value = String(result.getText() || "").trim();
      if (!value) throw new Error("No barcode found");
      controlsRef.current?.stop();
      onDetected(value);
    } catch {
      setError("Could not read a barcode from that photo. Move closer, hold steady and try again.");
    } finally {
      URL.revokeObjectURL(url);
      setDecoding(false);
    }
  };

  const submitManual = () => {
    const value = manual.trim();
    if (!value) return;
    controlsRef.current?.stop();
    onDetected(value);
  };

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl bg-slate-900">
          <video
            ref={videoRef}
            className="aspect-[4/3] w-full object-cover"
            muted
            playsInline
            autoPlay
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-28 w-4/5 rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
          </div>
          {starting && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70 text-sm font-medium text-white">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting camera…
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            {error}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPhoto}
              className="hidden"
              disabled={decoding}
            />
            {decoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {decoding ? "Reading photo…" : "Take photo"}
          </label>
          <div className="flex items-center justify-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            <Camera className="h-4 w-4" />
            Hardware scanners work in the scan box too
          </div>
        </div>

        <Field label="Or enter barcode">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitManual();
                  }
                }}
                placeholder="Type or scan barcode, then press Enter"
                autoComplete="off"
                className="pl-9 font-mono"
              />
            </div>
            <Button type="button" onClick={submitManual} disabled={!manual.trim()}>
              Use
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
