import { useCallback, useEffect, useRef, useState } from "react";

// ─── Draft storage ────────────────────────────────────────────────────────
// Form entries are written to IndexedDB (it holds File/Blob and large image
// data URLs that localStorage cannot). A tiny JSON copy also goes to
// localStorage as a synchronous safety net for the phone case: when a call
// arrives the browser can hide or discard the tab before an async IDB write
// has finished.
const DB_NAME = "storemaster_form_drafts";
const DB_VERSION = 1;
const STORE = "drafts";
const LS_PREFIX = "storemaster_form_draft:";
const OPEN_PREFIX = "storemaster_form_open:";
const SAVE_DEBOUNCE_MS = 250;

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function lsSet(key, value) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota full or private mode -- IDB is the real store */
  }
}

function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsDelete(key) {
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* ignore */
  }
}

function openSet(key, value) {
  try {
    localStorage.setItem(OPEN_PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function openGet(key) {
  try {
    const raw = localStorage.getItem(OPEN_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function openDelete(key) {
  try {
    localStorage.removeItem(OPEN_PREFIX + key);
  } catch {
    /* ignore */
  }
}

export async function loadDraft(key) {
  if (!key) return null;
  try {
    const draft = await idbGet(key);
    if (draft) return draft;
  } catch {
    /* fall through to the localStorage copy */
  }
  return lsGet(key);
}

export async function saveDraft(key, value) {
  if (!key) return;
  const draft = { savedAt: Date.now(), value };
  // Write the synchronous copy first; it is what survives an abrupt discard of
  // the tab. IDB is written second for full fidelity (images, Files).
  lsSet(key, draft);
  try {
    await idbPut(key, draft);
  } catch {
    /* the localStorage copy remains */
  }
}

export async function deleteDraft(key) {
  if (!key) return;
  lsDelete(key);
  try {
    await idbDelete(key);
  } catch {
    /* ignore */
  }
}

// ─── Dirty-form registry ──────────────────────────────────────────────────
// App uses this to avoid remounting the active page when another tab saves.
// Remounting is what used to blank an open form, so a dirty form now defers
// the refresh until it is saved, discarded or closed.
const dirtyForms = new Set();
const dirtyListeners = new Set();

function emitDirty() {
  for (const fn of dirtyListeners) {
    try {
      fn(dirtyForms.size);
    } catch {
      /* a listener must not break a form */
    }
  }
}

function markDirty(key, dirty) {
  if (!key) return;
  const had = dirtyForms.has(key);
  if (dirty && !had) dirtyForms.add(key);
  if (!dirty && had) dirtyForms.delete(key);
  if (dirty !== had) emitDirty();
}

export function hasDirtyDrafts() {
  return dirtyForms.size > 0;
}

export function subscribeDirtyDrafts(fn) {
  dirtyListeners.add(fn);
  return () => dirtyListeners.delete(fn);
}

// ─── Comparison ───────────────────────────────────────────────────────────
// Draft values are plain form state: objects, arrays, strings, numbers,
// booleans, File/Blob. JSON with sorted keys is enough to tell "unchanged"
// from "edited" without pulling in a deep-equal dependency.
function stable(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (typeof File !== "undefined" && value instanceof File) {
    return `file:${value.name}:${value.size}:${value.lastModified}`;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return `blob:${value.size}:${value.type}`;
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
    .join(",")}}`;
}

function same(a, b) {
  return stable(a) === stable(b);
}

// ─── Hook ─────────────────────────────────────────────────────────────────
// `value` is the live form state, `apply` writes a restored draft back into
// that state. The baseline -- "what the form looked like when it opened" -- is
// captured automatically, so a hook is just:
//
//   const draft = useFormDraft({ key, value: form, apply: setForm, active: open });
//
// and the form renders <DraftBanner draft={draft} />.
export function useFormDraft({ key, value, apply, active = true, enabled = true, autoRestore = true }) {
  const [status, setStatus] = useState("idle");
  const [pending, setPending] = useState(null);
  const [restoredAt, setRestoredAt] = useState(0);

  const valueRef = useRef(value);
  const applyRef = useRef(apply);
  const baselineRef = useRef(value);
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  const activeRef = useRef(active);
  const statusRef = useRef(status);

  valueRef.current = value;
  applyRef.current = apply;
  activeRef.current = active;
  statusRef.current = status;

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!enabled || !activeRef.current || statusRef.current !== "ready" || !key) return;
    if (!same(valueRef.current, baselineRef.current)) {
      saveDraft(key, valueRef.current);
    }
  }, [key, enabled]);

  // Load any draft whenever the form becomes active or switches record.
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !active || !key) {
      setStatus("idle");
      setPending(null);
      markDirty(key, false);
      return undefined;
    }

    baselineRef.current = valueRef.current;
    setStatus("checking");
    setPending(null);

    (async () => {
      const draft = await loadDraft(key);
      if (cancelled) return;
      if (draft && !same(draft.value, baselineRef.current)) {
        if (autoRestore) {
          applyRef.current(draft.value);
          setPending(null);
          setRestoredAt(Date.now());
          setStatus("ready");
        } else {
          setPending(draft);
          setStatus("prompt");
        }
      } else {
        if (draft) deleteDraft(key);
        setStatus("ready");
      }
    })();

    return () => {
      cancelled = true;
    };
    // `value` is deliberately not a dependency: this runs once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, enabled]);

  // Persist edits after a short pause so typing on a phone stays smooth.
  useEffect(() => {
    if (!enabled || !active || status !== "ready" || !key) {
      markDirty(key, false);
      return undefined;
    }

    const dirty = !same(value, baselineRef.current);
    markDirty(key, dirty);

    if (timerRef.current) clearTimeout(timerRef.current);
    if (dirty) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        saveDraft(key, valueRef.current);
      }, SAVE_DEBOUNCE_MS);
    } else {
      deleteDraft(key);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [key, value, active, status, enabled]);

  // Save the latest state when the tab is hidden (a call arrives) or closed.
  useEffect(() => {
    if (!enabled) return undefined;
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush, enabled]);

  // Never leave a form marked dirty after it unmounts.
  useEffect(() => () => markDirty(key, false), [key]);

  const restore = useCallback(() => {
    const draft = pendingRef.current;
    if (!draft) return;
    applyRef.current(draft.value);
    setPending(null);
    setStatus("ready");
    setRestoredAt(Date.now());
  }, []);

  const discard = useCallback(async () => {
    await deleteDraft(key);
    applyRef.current(baselineRef.current);
    setPending(null);
    setStatus(activeRef.current ? "ready" : "idle");
    markDirty(key, false);
  }, [key]);

  const clear = useCallback(async () => {
    await deleteDraft(key);
    baselineRef.current = valueRef.current;
    setPending(null);
    setRestoredAt(0);
    markDirty(key, false);
    setStatus(activeRef.current ? "ready" : "idle");
  }, [key]);

  return {
    status,
    pending,
    restoredAt,
    restore,
    discard,
    clear,
    flush
  };
}

// ─── Reopen a form after reload ───────────────────────────────────────────
// The draft itself is keyed per record (`suppliers:new`, `assets:edit:12`).
// This remembers which record's form was open, so after a reload the page can
// put the modal back on screen and let useFormDraft restore its contents.
//
//   useDraftReopen({
//     prefix: "assets",
//     open,
//     session: editing?.id ?? null,
//     onReopen: (id) => { setEditing(id ? { id } : null); setOpen(true); }
//   });
export function useDraftReopen({ prefix, open, session = null, onReopen, enabled = true }) {
  const bootedRef = useRef(false);
  const reopenRef = useRef(onReopen);
  reopenRef.current = onReopen;

  useEffect(() => {
    if (!enabled || bootedRef.current) return;
    bootedRef.current = true;
    if (open) return;
    const pointer = openGet(prefix);
    if (!pointer || !pointer.open) return;
    reopenRef.current?.(pointer.session ?? null);
  }, [enabled, prefix, open]);

  useEffect(() => {
    if (!enabled || !bootedRef.current) return;
    openSet(prefix, { open: !!open, session: session ?? null });
  }, [enabled, prefix, open, session]);
}

export function forgetOpenDraft(prefix) {
  openDelete(prefix);
}
