const BASE = "/api";

const CACHE_TTL = 10000;
const cache = new Map();
const inflight = new Map();

export function bustCache() {
  cache.clear();
}

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

function cachedGet(path) {
  const hit = cache.get(path);
  if (hit) {
    if (hit.expires > Date.now()) return hit.value;
    cache.delete(path);
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

export const api = {
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
  sales: () => call("/sales"),
  sale: (id) => call(`/sales/${id}`),
  createSale: (data) => call("/sales", { method: "POST", body: JSON.stringify(data) }),
  updateSale: (id, data) => call(`/sales/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateSaleStatus: (id, data) => call(`/sales/${id}/status`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSale: (id) => call(`/sales/${id}`, { method: "DELETE" }),
  customers: () => call("/customers"),
  createCustomer: (data) => call("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id, data) => call(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCustomer: (id) => call(`/customers/${id}`, { method: "DELETE" }),
  suppliers: () => call("/suppliers"),
  createSupplier: (data) => call("/suppliers", { method: "POST", body: JSON.stringify(data) }),
  updateSupplier: (id, data) => call(`/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSupplier: (id) => call(`/suppliers/${id}`, { method: "DELETE" }),
  employees: () => call("/employees"),
  createEmployee: (data) => call("/employees", { method: "POST", body: JSON.stringify(data) }),
  updateEmployee: (id, data) => call(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEmployee: (id) => call(`/employees/${id}`, { method: "DELETE" }),
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
  businessDocuments: () => call("/business-documents"),
  businessDocument: (id) => call(`/business-documents/${id}`),
  uploadBusinessDocumentFile: (file) =>
    request("/business-documents/upload", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-File-Type": file.type || "" },
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
  stats: (from, to) => call(`/stats?from=${from}&to=${to}`)
};