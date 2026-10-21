// A stack of open overlays.
//
// The hardware back button on a phone is expected to dismiss whatever is on
// screen before it starts walking the page trail -- a dialog closes, and only
// then does back move between pages.
//
// Every dialog in the app is built from the shared Modal component, so
// registering it there covers all of them at once. A page never has to know
// that back presses exist.

import { useEffect, useRef, useState } from "react";

const overlays = new Map();
let overlaySeq = 0;

// A Map keeps insertion order, so the last key registered is the one on top.
// Re-registering an existing key keeps its original position, which matters:
// a parent that re-renders must not push its dialog below another one.
export function registerOverlay(id, close) {
  overlays.set(id, close);
  return () => overlays.delete(id);
}

// Close the topmost overlay. Returns true when one was closed, so the caller
// knows the back press was consumed and the page trail must not move.
export function closeTopOverlay() {
  const ids = [...overlays.keys()];
  const id = ids[ids.length - 1];
  if (id === undefined) return false;
  const close = overlays.get(id);
  overlays.delete(id);
  try {
    close?.();
  } catch {
    /* a dialog that fails to close must not break the back button */
  }
  return true;
}

// For the few overlays that are not built from the shared Modal component.
// The close handler is held in a ref so a parent that re-renders with a new
// function does not re-register the overlay and lose its place in the stack.
export function useOverlay(open, onClose) {
  const [id] = useState(() => `overlay-${++overlaySeq}`);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    return registerOverlay(id, () => closeRef.current?.());
  }, [open, id]);
}
