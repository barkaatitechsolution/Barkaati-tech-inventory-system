import { useEffect, useRef } from "react";

// The Sales workspace is one named tab. The first CMD:SALE scan opens it;
// later scans bring that same tab forward and ask it to show New Sale.

export const SALES_TAB_NAME = "storemaster-sales";

const CHANNEL_NAME = "storemaster-sales-tab";
const OPEN_SALE = "storemaster:open-new-sale";
const PING = "storemaster:ping";
const PONG = "storemaster:pong";

let channel = null;
let pingSeq = 0;

function getChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }
  return channel;
}

export function isSalesTab() {
  try {
    return window.name === SALES_TAB_NAME;
  } catch {
    return false;
  }
}

function hasSalesTab(timeoutMs = 300) {
  const bus = getChannel();
  if (!bus) return Promise.resolve(false);
  const id = `ping-${Date.now()}-${++pingSeq}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bus.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event) => {
      if (event.data?.type === PONG && event.data.id === id) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    bus.addEventListener("message", onMessage);
    bus.postMessage({ type: PING, id });
  });
}

// Returns false only when a new tab had to be opened but the browser blocked
// it. An existing tab is asked to open the form without being reloaded.
export async function requestSalesTab(url) {
  const alive = await hasSalesTab();
  if (!alive) {
    let tab = null;
    try {
      tab = window.open(url, SALES_TAB_NAME);
    } catch {
      return false;
    }
    if (!tab) return false;
    try {
      tab.opener = null;
    } catch {
      /* the tab is open; severing opener is best effort */
    }
    return true;
  }

  let tab = null;
  try {
    tab = window.open("", SALES_TAB_NAME);
  } catch {
    /* focus is best effort; the message below still reaches the tab */
  }
  try {
    tab?.focus?.();
  } catch {
    /* ignore */
  }
  try {
    getChannel()?.postMessage({ type: OPEN_SALE });
  } catch {
    return false;
  }
  return true;
}

export function useSalesTab({ enabled, onOpenSale }) {
  const onOpenRef = useRef(onOpenSale);
  useEffect(() => {
    onOpenRef.current = onOpenSale;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const bus = getChannel();
    if (!bus) return undefined;

    const onMessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === PING) {
        bus.postMessage({ type: PONG, id: data.id });
        return;
      }
      if (data.type === OPEN_SALE) {
        try {
          window.focus();
        } catch {
          /* the opener already tried to focus this tab */
        }
        onOpenRef.current?.();
      }
    };

    bus.addEventListener("message", onMessage);
    return () => bus.removeEventListener("message", onMessage);
  }, [enabled]);
}
