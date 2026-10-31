const KEY = "barkaati-store-last-order";

export function rememberOrder(order) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* private mode or storage disabled — the success page simply falls back */
  }
}

export function recallOrder() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function forgetOrder() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
