// A navigation stack for the single-page app.
//
// App.jsx keeps the current page in React state and every page asks for the
// next one through onNavigate(). That is all a desktop needs, but on a phone
// the hardware back button has to walk the same path the user took -- with the
// browser back button (or the Android back button in a native build) leaving
// the app on the very first press.
//
// The trail of visited pages is mirrored into window.history: one history entry
// per step of the trail, and every entry carries the trail it was created at.
// A back press then arrives as a popstate that says exactly where to land, so
// one press always means one step back -- no more, no less.
//
// The trail also goes into sessionStorage. A phone throws a page out of its
// back/forward cache under memory pressure and loads it again when the user
// comes back; without a copy the history would be gone and the back button
// would stop working.

import { useCallback, useEffect, useRef, useState } from "react";

// A very long trail is noise in the breadcrumb and wastes history entries.
const MAX_TRAIL = 12;

// Marks the history entries that belong to this app, so they can be told
// apart from the ones the browser made for itself.
const MARKER = "storemaster";

// Where the trail is kept between a reload.
const STORAGE_KEY = "storemaster.trail";

// The native bridge, if the app is running inside a native shell. Detected
// rather than imported so the web build stays free of the plugin.
const nativeApp = () => {
  try {
    return window.Capacitor?.Plugins?.App || null;
  } catch {
    return null;
  }
};

// "reload" when the page was reloaded, "back_forward" when it came back out
// of the browser's cache, "navigate" for a fresh load.
const navType = () => {
  try {
    return performance.getEntriesByType("navigation")[0]?.type || "navigate";
  } catch {
    return "navigate";
  }
};

const readStored = () => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (!Array.isArray(parsed)) return null;
    const trail = parsed.filter((s) => s && typeof s.page === "string");
    return trail.length ? trail : null;
  } catch {
    return null;
  }
};

const writeStored = (trail) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trail));
  } catch {
    /* private mode, or the quota is full -- the history entry still has it */
  }
};

export function useNavigation({ initialPage = "dashboard", onExit, beforeBack } = {}) {
  // Where the app was when it booted. The history entry knows: it carries the
  // trail it was created at, and it survives a reload. sessionStorage covers
  // the case where the browser moved the history position and then loaded the
  // page again, which is what a phone does when it evicts a tab from its
  // back/forward cache.
  const boot = useRef(null);
  if (boot.current === null) {
    const fromHistory = window.history.state?.[MARKER]?.trail;
    let trail = null;
    if (Array.isArray(fromHistory) && fromHistory.length) trail = fromHistory;
    else if (navType() === "reload") trail = readStored();
    boot.current = trail && trail.length ? trail : [{ page: initialPage }];
  }

  const [trail, setTrail] = useState(boot.current);
  const [page, setPage] = useState(boot.current[boot.current.length - 1].page);

  const trailRef = useRef(boot.current);
  const pageRef = useRef(page);

  // The history listener is registered once, so the callbacks it needs are
  // read through a ref that is refreshed after every render.
  const latest = useRef({ onExit, beforeBack });
  useEffect(() => {
    latest.current = { onExit, beforeBack };
  });

  const applyTrail = useCallback((nextTrail) => {
    const capped =
      nextTrail.length > MAX_TRAIL ? nextTrail.slice(nextTrail.length - MAX_TRAIL) : nextTrail;
    const last = capped[capped.length - 1];
    trailRef.current = capped;
    pageRef.current = last.page;
    writeStored(capped);
    setTrail(capped);
    setPage(last.page);
    return capped;
  }, []);

  // Write the current position into a history entry. Every entry carries the
  // trail it was created at, so a back press -- or a reload -- can always work
  // out where to land.
  const writeEntry = useCallback((entryTrail, replace = false) => {
    const state = {
      [MARKER]: true,
      page: entryTrail[entryTrail.length - 1].page,
      trail: entryTrail
    };
    try {
      if (replace) window.history.replaceState(state, "");
      else window.history.pushState(state, "");
    } catch {
      /* history disabled (private mode) -- the back button then does nothing */
    }
  }, []);

  const handlePop = useCallback(
    (event) => {
      // A dialog or the drawer takes the back press first: it closes, and the
      // trail stays exactly where it is.
      if (latest.current.beforeBack?.()) {
        // The browser already moved one step back, so put the same position
        // back on top of the stack. The depth and the trail stay in step.
        writeEntry(trailRef.current);
        return;
      }

      const state = event.state;
      if (state?.[MARKER] && Array.isArray(state.trail) && state.trail.length) {
        // One of our own entries: it knows the trail it was created at.
        applyTrail(state.trail);
        return;
      }

      // The browser went past the first entry, so the user is trying to leave
      // the app. Put an entry back, or the next back press would drop out of
      // the app entirely instead of asking again.
      writeEntry(trailRef.current);
      latest.current.onExit?.();
    },
    [applyTrail, writeEntry]
  );

  const handlePopRef = useRef(handlePop);
  useEffect(() => {
    handlePopRef.current = handlePop;
  });

  // The browser back button.
  useEffect(() => {
    const onPop = (event) => handlePopRef.current(event);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // The first entry. On a fresh load the app has to add one, or the first back
  // press would leave the site. When the page was reloaded, the entry the app
  // is standing on is already ours, so it is refreshed instead of added to.
  useEffect(() => {
    const ours = window.history.state?.[MARKER];
    writeEntry(trailRef.current, !!ours);
  }, [writeEntry]);

  // A native build reports the hardware back button through the Capacitor App
  // plugin. Registering a listener overrides the WebView's own history
  // handling, so the app asks the history to step back itself -- the same
  // code path a browser back press takes.
  useEffect(() => {
    const App = nativeApp();
    if (!App?.addListener) return undefined;
    let handle;
    try {
      handle = App.addListener("backButton", () => {
        window.history.back();
      });
    } catch {
      return undefined;
    }
    return () => {
      Promise.resolve(handle)
        .then((h) => h?.remove?.())
        .catch(() => {});
    };
  }, []);

  const navigate = useCallback(
    (nextPage) => {
      if (!nextPage) return;
      const prev = trailRef.current;

      if (nextPage === pageRef.current) {
        // Already on this page. Keep the history entry as it is.
        writeEntry(prev, true);
        return;
      }

      const idx = prev.findIndex((t) => t.page === nextPage);
      if (idx >= 0 && idx < prev.length - 1) {
        // Re-visiting a page that is further up the trail: move back to it
        // instead of stacking a second copy, so the breadcrumb reads
        // "Dashboard / Product DB" rather than "Dashboard / Product DB /
        // Product DB". The entry we land on already carries the right trail.
        const drop = prev.length - 1 - idx;
        try {
          window.history.go(-drop);
        } catch {
          /* the history is not ours to move -- fall through to a plain push */
        }
        return;
      }

      const next = idx >= 0 ? prev.slice(0, idx + 1) : [...prev, { page: nextPage }];
      writeEntry(applyTrail(next));
    },
    [applyTrail, writeEntry]
  );

  // Walk one step back. The history does the moving; the popstate handler
  // reads where it landed and updates the trail.
  const goBack = useCallback(() => {
    window.history.back();
  }, []);

  return { page, trail, navigate, goBack };
}
