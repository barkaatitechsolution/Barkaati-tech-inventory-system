import { useEffect, useRef } from "react";
import { looksLikeGlobalScanCode, looksLikeScanCode } from "./optionSearch.js";

const SCAN_MAX_GAP_MS = 300;
const SCAN_IDLE_MS = 350;
const SCAN_MIN_LENGTH = 4;

export default function useScannerCapture({ enabled = true, onScan, prefixes = null }) {
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let lastAt = 0;
    let scanDetected = false;
    let idleTimer = null;
    let target = null;
    let originalValue = null;
    let originalStart = null;
    let originalEnd = null;
    let originalContent = null;

    const clearIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const restoreTarget = () => {
      const el = target;
      const value = originalValue;
      const start = originalStart;
      const end = originalEnd;
      const content = originalContent;
      target = null;
      originalValue = null;
      originalStart = null;
      originalEnd = null;
      originalContent = null;
      if (!el || !document.contains(el)) return;
      try {
        if (el.isContentEditable) {
          if (content !== null) {
            el.textContent = content;
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
          return;
        }
        if (value === null) return;
        const proto =
          el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        if (typeof start === "number") {
          try {
            el.setSelectionRange(start, typeof end === "number" ? end : start);
          } catch {}
        }
      } catch {}
    };

    const reset = ({ restore = false } = {}) => {
      clearIdle();
      if (restore) restoreTarget();
      buffer = "";
      lastAt = 0;
      scanDetected = false;
      target = null;
      originalValue = null;
      originalStart = null;
      originalEnd = null;
      originalContent = null;
    };

    const submit = (code) => {
      const value = String(code || "").trim();
      reset({ restore: true });
      if (value.length >= SCAN_MIN_LENGTH) onScanRef.current?.(value);
    };

    const isScanField = (el) => {
      if (!el || typeof el.getAttribute !== "function") return false;
      const text = [
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.getAttribute("title")
      ]
        .filter(Boolean)
        .join(" ");
      return /scan|barcode/i.test(text);
    };

    const normalize = (code) =>
      String(code || "")
        .trim()
        .replace(/^\*+|\*+$/g, "")
        .replace(/^\][A-Z]\d/i, "");

    const hasPrefix = (code) => {
      if (!prefixes || prefixes.length === 0) return true;
      const value = normalize(code).toUpperCase();
      return prefixes.some((prefix) => value.startsWith(String(prefix).toUpperCase()));
    };

    const likelyScan = (code) => {
      if (prefixes && prefixes.length > 0) {
        return hasPrefix(code) && normalize(code).length >= SCAN_MIN_LENGTH;
      }
      return looksLikeGlobalScanCode(code) || (isScanField(target) && looksLikeScanCode(code));
    };

    const rememberTarget = (el) => {
      target = el;
      originalValue = null;
      originalStart = null;
      originalEnd = null;
      originalContent = null;
      if (!el) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        originalValue = el.value;
        originalStart = el.selectionStart;
        originalEnd = el.selectionEnd;
      } else if (el.isContentEditable) {
        originalContent = el.textContent;
      }
    };

    const onKeyDown = (event) => {
      if (event.isComposing || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "Enter" || event.key === "Tab") {
        if (scanDetected && buffer.length >= SCAN_MIN_LENGTH) {
          event.preventDefault();
          event.stopPropagation();
          submit(buffer);
        } else {
          reset({ restore: scanDetected });
        }
        return;
      }

      if (event.key.length !== 1) return;

      const now = performance.now();
      const gap = now - lastAt;

      if (!buffer || gap > SCAN_MAX_GAP_MS) {
        if (scanDetected) {
          const previous = buffer;
          const shouldSubmit =
            previous.length >= SCAN_MIN_LENGTH && likelyScan(previous);
          reset({ restore: true });
          if (shouldSubmit) onScanRef.current?.(previous);
        } else {
          reset();
        }
        rememberTarget(event.target);
        buffer = event.key;
        lastAt = now;
        scanDetected = false;
      } else {
        buffer += event.key;
        lastAt = now;
      }

      if (!scanDetected && buffer.length >= SCAN_MIN_LENGTH && likelyScan(buffer)) {
        scanDetected = true;
      }

      if (scanDetected) {
        event.preventDefault();
        event.stopPropagation();
      }

      clearIdle();
      idleTimer = setTimeout(() => {
        if (scanDetected && buffer.length >= SCAN_MIN_LENGTH && likelyScan(buffer)) submit(buffer);
        else reset({ restore: scanDetected });
      }, SCAN_IDLE_MS);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      reset({ restore: true });
    };
  }, [enabled]);
}
