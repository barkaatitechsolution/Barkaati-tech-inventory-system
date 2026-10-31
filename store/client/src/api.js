async function call(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  storeInfo: () => call("/api/store-info"),
  products: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.category_id) qs.set("category_id", String(params.category_id));
    const query = qs.toString();
    return call(`/api/products${query ? `?${query}` : ""}`);
  },
  product: (id) => call(`/api/products/${id}`),
  categories: () => call("/api/categories"),
  createOrder: (data) => call("/api/orders", { method: "POST", body: data }),
  lookupOrder: (data) => call("/api/orders/lookup", { method: "POST", body: data })
};
