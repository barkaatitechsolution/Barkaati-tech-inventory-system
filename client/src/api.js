const BASE = "/api";

const CACHE_TTL = 10000;
const cache = new Map();
const inflight = new Map();

// Long enough that a heavy report over a real dataset never trips it, short
// enough that a wedged connection cannot pin a caller's closure indefinitely.
const DEFAULT_TIMEOUT_MS = 30000;

// ─── Cross-tab invalidation ──────────────────────────────
// The 10s cache is per-tab, so a sale rung up on the counter tablet left the
// office laptop showing stale stock for up to ten seconds. Writes already funnel
// through bustCache(), so that is where peers get told. BroadcastChannel covers
// modern browsers; the localStorage ping is the fallback (the `storage` event
// only fires in *other* tabs, so a tab never reacts to its own write).
const PEER_KEY = "storemaster_peer_ping";
const PEER_CHANNEL = "storemaster-sync";
const peerListeners = new Set();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(PEER_CHANNEL) : null;

function emitPeerChange() {
  for (const fn of peerListeners) {
    try {
      fn();
    } catch {
      /* a bad listener must not break the write that triggered it */
    }
  }
}

function onPeerSignal() {
  cache.clear();
  emitPeerChange();
}

if (channel) {
  channel.onmessage = onPeerSignal;
}
window.addEventListener("storage", (e) => {
  if (e.key === PEER_KEY) onPeerSignal();
});

// Subscribe to writes made in another tab. Returns an unsubscribe function.
export function onPeerChange(fn) {
  peerListeners.add(fn);
  return () => peerListeners.delete(fn);
}

export function bustCache() {
  cache.clear();
  if (channel) {
    try {
      channel.postMessage("changed");
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.setItem(PEER_KEY, String(Date.now()));
  } catch {
    /* private mode -- BroadcastChannel, if present, already did the job */
  }
}

async function request(path, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = options;
  // Every fetch needs a deadline. Without one a request that hangs on a dead
  // socket never settles, so the caller's closure -- component state included --
  // stays pinned for the life of the tab. Most pages call api.* from a mount
  // effect, so an unresolved promise is a permanent leak, not a slow load.
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort);
  }
  try {
    const res = await fetch(BASE + path, {
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...rest.headers },
      ...rest
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = await res.json();
        if (body.error) message = body.error;
      } catch {
        /* ignore */
      }
      // A 404 from the API's catch-all means the request reached a server that
      // has never heard of this route -- which, in a split client/server local
      // app, is nearly always a server process still running code from before
      // the change. "API route not found" sends people hunting for a wrong URL;
      // naming the actual cause saves that whole detour.
      if (res.status === 404 && /API route not found/i.test(message)) {
        message =
          "This server is running older code and does not have this endpoint yet. Restart it (npm run start --prefix server) and reload.";
      }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json();
  } catch (err) {
    // An abort with no status is our own deadline firing, not a real failure.
    if (timedOut) throw new Error("The server took too long to respond. Please try again.");
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
  }
}

function cachedGet(path) {
  const hit = cache.get(path);
  if (hit) {
    if (hit.expires > Date.now()) return hit.value;
    cache.delete(path);
  }
  // An entry is otherwise only dropped when that exact path is requested again,
  // so a browse-only session leaks response bodies: the debounced search box
  // makes every keystroke a distinct "?q=" key. Sweep the dead ones once the map
  // is big enough to matter.
  if (cache.size > 40) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  }
  let pending = inflight.get(path);
  if (!pending) {
    pending = request(path)
      .then((value) => {
        cache.set(path, { value, expires: Date.now() + CACHE_TTL });
        return value;
      })
      .finally(() => inflight.delete(path));
    inflight.set(path, pending);
  }
  return pending;
}

function call(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  // `fresh: true` skips the 10s cache for a single path -- used where the whole
  // point of the request is to see the latest value written by another device.
  if (method === "GET" && options.fresh) {
    cache.delete(path);
    const { fresh, ...rest } = options;
    return request(path, rest);
  }
  if (method === "GET") return cachedGet(path);
  bustCache();
  return request(path, options);
}

function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    p.append(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// Browsers report a useless "application/octet-stream" (or "") for .docx/.xlsx
// whenever Office is not registered with the OS, which is common on Android, on
// cloud pickers and on freshly installed Windows. Fall back to the extension so
// Word and Excel files upload instead of being rejected as unsupported.
const DOC_MIME_BY_EXT = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  csv: "text/csv",
  rtf: "application/rtf",
  txt: "text/plain"
};

export const docMimeOf = (file) => {
  const t = String(file?.type || "").toLowerCase();
  if (t && t !== "application/octet-stream") return t;
  const ext = String(file?.name || "").split(".").pop()?.toLowerCase() || "";
  return DOC_MIME_BY_EXT[ext] || t || "application/octet-stream";
};

export const api = {
  storeInfo: (options) => call("/store-info", options),
  saveStoreInfo: (data) => call("/store-info", { method: "PUT", body: JSON.stringify(data) }),
  dashboard: () => call("/dashboard"),
  categories: () => call("/categories"),
  createCategory: (data) => call("/categories", { method: "POST", body: JSON.stringify(data) }),
  updateCategory: (id, data) => call(`/categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCategory: (id) => call(`/categories/${id}`, { method: "DELETE" }),
  items: () => call("/items"),
  products: (params) => call(`/products${qs(params)}`),
  productOptions: () => call("/product-options"),
  product: (id) => call(`/products/${id}`),
  createProduct: (data) => call("/products", { method: "POST", body: JSON.stringify(data) }),
  updateProduct: (id, data) => call(`/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProduct: (id) => call(`/products/${id}`, { method: "DELETE" }),
  updateProductPrices: (id, data) => call(`/product-prices/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  uploadProductImages: (id, files) => call(`/products/${id}/images`, { method: "POST", body: JSON.stringify({ files }) }),
  deleteProductImages: (id, ids) => call(`/products/${id}/images`, { method: "DELETE", body: JSON.stringify({ ids }) }),
  orderProductImages: (id, order) => call(`/products/${id}/images/order`, { method: "PUT", body: JSON.stringify({ order }) }),
  supplierPurchases: () => call("/supplier-purchases"),
  supplierPurchase: (id) => call(`/supplier-purchases/${id}`),
  createSupplierPurchase: (data) => call("/supplier-purchases", { method: "POST", body: JSON.stringify(data) }),
  updateSupplierPurchase: (id, data) => call(`/supplier-purchases/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateSupplierPayment: (id, data) => call(`/supplier-purchases/${id}/payment`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSupplierPurchase: (id) => call(`/supplier-purchases/${id}`, { method: "DELETE" }),
  sales: (filters = "") => call(`/sales${filters ? `?${filters}` : ""}`),
  sale: (id) => call(`/sales/${id}`),
  createSale: (data) => call("/sales", { method: "POST", body: JSON.stringify(data) }),
  updateSale: (id, data) => call(`/sales/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateSaleStatus: (id, data) => call(`/sales/${id}/status`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSale: (id) => call(`/sales/${id}`, { method: "DELETE" }),
  saleByInvoice: (invoiceNo) => call(`/sales/invoice/${encodeURIComponent(invoiceNo)}`),
  returns: (params) => call(`/returns${qs(params)}`),
  createReturn: (saleId, data) => call(`/sales/${saleId}/returns`, { method: "POST", body: JSON.stringify(data) }),
  customers: () => call("/customers"),
  createCustomer: (data) => call("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id, data) => call(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCustomer: (id) => call(`/customers/${id}`, { method: "DELETE" }),
  suppliers: () => call("/suppliers"),
  createSupplier: (data) => call("/suppliers", { method: "POST", body: JSON.stringify(data) }),
  updateSupplier: (id, data) => call(`/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSupplier: (id) => call(`/suppliers/${id}`, { method: "DELETE" }),
  employees: (month) => call(`/employees${month ? `?month=${month}` : ""}`),
  employee: (id, month) => call(`/employees/${id}${month ? `?month=${month}` : ""}`),
  employeeLedger: (id, month) => call(`/employees/${id}/ledger?month=${month}`),
  createEmployee: (data) => call("/employees", { method: "POST", body: JSON.stringify(data) }),
  updateEmployee: (id, data) => call(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEmployee: (id) => call(`/employees/${id}`, { method: "DELETE" }),
  // Employee papers go up as the raw File rather than a base64 data URL, which
  // keeps a large scanned PDF off the main thread on a slow machine.
  uploadEmployeeDoc: (id, file, label) => {
    bustCache();
    return request(`/employees/${id}/documents/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name || "file"),
        "x-file-label": encodeURIComponent(label || "")
      },
      body: file
    });
  },
  deleteEmployeeDoc: (id) => call(`/employee-documents/${id}`, { method: "DELETE" }),
  attendance: (from, to, employeeId) => call(`/attendance?from=${from || ""}&to=${to || ""}${employeeId ? `&employee_id=${employeeId}` : ""}`),
  saveAttendance: (data) => call("/attendance", { method: "POST", body: JSON.stringify(data) }),
  updateAttendance: (id, data) => call(`/attendance/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAttendance: (id) => call(`/attendance/${id}`, { method: "DELETE" }),
  employeePayments: (id) => call(`/employees/${id}/payments`),
  payments: (from, to, employeeId) =>
    call(`/payments?from=${from || ""}&to=${to || ""}${employeeId ? `&employee_id=${employeeId}` : ""}`),
  createEmployeePayment: (id, data) => call(`/employees/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
  deletePayment: (id) => call(`/payments/${id}`, { method: "DELETE" }),
  vouchers: (filters = "") => call(`/vouchers${filters ? `?${filters}` : ""}`),
  validateVoucher: (code, total) => call(`/vouchers/validate?code=${encodeURIComponent(code)}${total != null ? `&total=${total}` : ""}`),
  deleteVoucher: (id) => call(`/vouchers/${id}`, { method: "DELETE" }),
  voucherCampaigns: () => call("/voucher-campaigns"),
  createVoucherCampaign: (data) => call("/voucher-campaigns", { method: "POST", body: JSON.stringify(data) }),
  updateVoucherCampaign: (id, data) => call(`/voucher-campaigns/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteVoucherCampaign: (id) => call(`/voucher-campaigns/${id}`, { method: "DELETE" }),
  assets: () => call("/assets"),
  createAsset: (data) => call("/assets", { method: "POST", body: JSON.stringify(data) }),
  updateAsset: (id, data) => call(`/assets/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAsset: (id) => call(`/assets/${id}`, { method: "DELETE" }),
  cheques: (filters = "") => call(`/cheques${filters ? `?${filters}` : ""}`),
  cheque: (id) => call(`/cheques/${id}`),
  createCheque: (data) => call("/cheques", { method: "POST", body: JSON.stringify(data) }),
  updateCheque: (id, data) => call(`/cheques/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateChequeStatus: (id, status) => call(`/cheques/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteCheque: (id) => call(`/cheques/${id}`, { method: "DELETE" }),
  expenses: () => call("/expenses"),
  createExpense: (data) => call("/expenses", { method: "POST", body: JSON.stringify(data) }),
  deleteExpense: (id) => call(`/expenses/${id}`, { method: "DELETE" }),
  expenseCategories: () => call("/expense-categories"),
  createExpenseCategory: (data) => call("/expense-categories", { method: "POST", body: JSON.stringify(data) }),
  updateExpenseCategory: (id, data) => call(`/expense-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteExpenseCategory: (id) => call(`/expense-categories/${id}`, { method: "DELETE" }),
  assetCategories: () => call("/asset-categories"),
  createAssetCategory: (data) => call("/asset-categories", { method: "POST", body: JSON.stringify(data) }),
  updateAssetCategory: (id, data) => call(`/asset-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAssetCategory: (id) => call(`/asset-categories/${id}`, { method: "DELETE" }),
  measuringUnits: () => call("/measuring-units"),
  measuringUnit: (id) => call(`/measuring-units/${id}`),
  createMeasuringUnit: (data) => call("/measuring-units", { method: "POST", body: JSON.stringify(data) }),
  updateMeasuringUnit: (id, data) => call(`/measuring-units/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMeasuringUnit: (id) => call(`/measuring-units/${id}`, { method: "DELETE" }),
  productPacks: (productId) => call(`/product-packs${productId ? `?product_id=${productId}` : ""}`),
  productPack: (id) => call(`/product-packs/${id}`),
  updateProductPack: (id, data) => call(`/product-packs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  tasks: (filters = "") => call(`/tasks${filters ? `?${filters}` : ""}`),
  task: (id) => call(`/tasks/${id}`),
  createTask: (data) => call("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id, data) => call(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateTaskStatus: (id, status) => call(`/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteTask: (id) => call(`/tasks/${id}`, { method: "DELETE" }),
  reminders: () => call("/reminders"),
  businessDocuments: () => call("/business-documents"),
  businessDocument: (id) => call(`/business-documents/${id}`),
  uploadBusinessDocumentFile: (file) =>
    request("/business-documents/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Type": docMimeOf(file),
        "X-File-Name": encodeURIComponent(String(file?.name || ""))
      },
      body: file
    }),
  createBusinessDocument: (data) => call("/business-documents", { method: "POST", body: JSON.stringify(data) }),
  updateBusinessDocument: (id, data) => call(`/business-documents/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteBusinessDocument: (id) => call(`/business-documents/${id}`, { method: "DELETE" }),
  businessDocumentCategories: () => call("/business-document-categories"),
  createBusinessDocumentCategory: (data) => call("/business-document-categories", { method: "POST", body: JSON.stringify(data) }),
  updateBusinessDocumentCategory: (id, data) => call(`/business-document-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteBusinessDocumentCategory: (id) => call(`/business-document-categories/${id}`, { method: "DELETE" }),
  customerCategories: () => call("/customer-categories"),
  createCustomerCategory: (data) => call("/customer-categories", { method: "POST", body: JSON.stringify(data) }),
  updateCustomerCategory: (id, data) => call(`/customer-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCustomerCategory: (id) => call(`/customer-categories/${id}`, { method: "DELETE" }),
  customerPrices: (productId, prices) => call(`/customer-prices/${productId}`, { method: "PUT", body: JSON.stringify({ prices }) }),
  brokers: () => call("/brokers"),
  createBroker: (data) => call("/brokers", { method: "POST", body: JSON.stringify(data) }),
  updateBroker: (id, data) => call(`/brokers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteBroker: (id) => call(`/brokers/${id}`, { method: "DELETE" }),
  brokerEnquiries: (params) => call(`/broker-enquiries${qs(params)}`),
  brokerEnquiry: (id) => call(`/broker-enquiries/${id}`),
  createBrokerEnquiry: (data) => call("/broker-enquiries", { method: "POST", body: JSON.stringify(data) }),
  updateBrokerEnquiryStatus: (id, status) =>
    call(`/broker-enquiries/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteBrokerEnquiry: (id) => call(`/broker-enquiries/${id}`, { method: "DELETE" }),
  stats: (from, to) => call(`/stats?from=${from}&to=${to}`),
  inspectBackup: (file) =>
    request("/backup/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(String(file?.name || "")) },
      body: file,
      timeoutMs: 120000
    }),
  importBackup: (file, mode) =>
    request("/backup/import", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Import-Mode": mode },
      body: file,
      // Restores rewrite the whole database, so this legitimately runs for
      // minutes on a large file. No deadline -- aborting midway would leave
      // the store half-imported, which is far worse than waiting.
      timeoutMs: 0
    }).then((res) => {
      bustCache();
      return res;
    })
};