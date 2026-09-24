const BASE = "/api";

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

export const api = {
  dashboard: () => request("/dashboard"),
  categories: () => request("/categories"),
  createCategory: (data) => request("/categories", { method: "POST", body: JSON.stringify(data) }),
  updateCategory: (id, data) => request(`/categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: "DELETE" }),
  items: () => request("/items"),
  products: () => request("/products"),
  product: (id) => request(`/products/${id}`),
  createProduct: (data) => request("/products", { method: "POST", body: JSON.stringify(data) }),
  updateProduct: (id, data) => request(`/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: "DELETE" }),
  updateProductPrices: (id, data) => request(`/product-prices/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  uploadProductImages: (id, files) => request(`/products/${id}/images`, { method: "POST", body: JSON.stringify({ files }) }),
  deleteProductImages: (id, ids) => request(`/products/${id}/images`, { method: "DELETE", body: JSON.stringify({ ids }) }),
  orderProductImages: (id, order) => request(`/products/${id}/images/order`, { method: "PUT", body: JSON.stringify({ order }) }),
  supplierPurchases: () => request("/supplier-purchases"),
  supplierPurchase: (id) => request(`/supplier-purchases/${id}`),
  createSupplierPurchase: (data) => request("/supplier-purchases", { method: "POST", body: JSON.stringify(data) }),
  updateSupplierPurchase: (id, data) => request(`/supplier-purchases/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateSupplierPayment: (id, data) => request(`/supplier-purchases/${id}/payment`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSupplierPurchase: (id) => request(`/supplier-purchases/${id}`, { method: "DELETE" }),
  sales: () => request("/sales"),
  sale: (id) => request(`/sales/${id}`),
  createSale: (data) => request("/sales", { method: "POST", body: JSON.stringify(data) }),
  updateSale: (id, data) => request(`/sales/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateSaleStatus: (id, data) => request(`/sales/${id}/status`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSale: (id) => request(`/sales/${id}`, { method: "DELETE" }),
  customers: () => request("/customers"),
  createCustomer: (data) => request("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id, data) => request(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCustomer: (id) => request(`/customers/${id}`, { method: "DELETE" }),
  suppliers: () => request("/suppliers"),
  createSupplier: (data) => request("/suppliers", { method: "POST", body: JSON.stringify(data) }),
  updateSupplier: (id, data) => request(`/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSupplier: (id) => request(`/suppliers/${id}`, { method: "DELETE" }),
  employees: () => request("/employees"),
  createEmployee: (data) => request("/employees", { method: "POST", body: JSON.stringify(data) }),
  updateEmployee: (id, data) => request(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEmployee: (id) => request(`/employees/${id}`, { method: "DELETE" }),
  attendance: (from, to, employeeId) => request(`/attendance?from=${from || ""}&to=${to || ""}${employeeId ? `&employee_id=${employeeId}` : ""}`),
  saveAttendance: (data) => request("/attendance", { method: "POST", body: JSON.stringify(data) }),
  updateAttendance: (id, data) => request(`/attendance/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAttendance: (id) => request(`/attendance/${id}`, { method: "DELETE" }),
  employeePayments: (id) => request(`/employees/${id}/payments`),
  payments: (from, to, employeeId) =>
    request(`/payments?from=${from || ""}&to=${to || ""}${employeeId ? `&employee_id=${employeeId}` : ""}`),
  createEmployeePayment: (id, data) => request(`/employees/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
  deletePayment: (id) => request(`/payments/${id}`, { method: "DELETE" }),
  vouchers: (filters = "") => request(`/vouchers${filters ? `?${filters}` : ""}`),
  validateVoucher: (code, total) => request(`/vouchers/validate?code=${encodeURIComponent(code)}${total != null ? `&total=${total}` : ""}`),
  deleteVoucher: (id) => request(`/vouchers/${id}`, { method: "DELETE" }),
  voucherCampaigns: () => request("/voucher-campaigns"),
  createVoucherCampaign: (data) => request("/voucher-campaigns", { method: "POST", body: JSON.stringify(data) }),
  updateVoucherCampaign: (id, data) => request(`/voucher-campaigns/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteVoucherCampaign: (id) => request(`/voucher-campaigns/${id}`, { method: "DELETE" }),
  assets: () => request("/assets"),
  createAsset: (data) => request("/assets", { method: "POST", body: JSON.stringify(data) }),
  updateAsset: (id, data) => request(`/assets/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAsset: (id) => request(`/assets/${id}`, { method: "DELETE" }),
  expenses: () => request("/expenses"),
  createExpense: (data) => request("/expenses", { method: "POST", body: JSON.stringify(data) }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: "DELETE" }),
  expenseCategories: () => request("/expense-categories"),
  createExpenseCategory: (data) => request("/expense-categories", { method: "POST", body: JSON.stringify(data) }),
  updateExpenseCategory: (id, data) => request(`/expense-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteExpenseCategory: (id) => request(`/expense-categories/${id}`, { method: "DELETE" }),
  assetCategories: () => request("/asset-categories"),
  createAssetCategory: (data) => request("/asset-categories", { method: "POST", body: JSON.stringify(data) }),
  updateAssetCategory: (id, data) => request(`/asset-categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAssetCategory: (id) => request(`/asset-categories/${id}`, { method: "DELETE" }),
  measuringUnits: () => request("/measuring-units"),
  measuringUnit: (id) => request(`/measuring-units/${id}`),
  createMeasuringUnit: (data) => request("/measuring-units", { method: "POST", body: JSON.stringify(data) }),
  updateMeasuringUnit: (id, data) => request(`/measuring-units/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMeasuringUnit: (id) => request(`/measuring-units/${id}`, { method: "DELETE" }),
  productPacks: (productId) => request(`/product-packs${productId ? `?product_id=${productId}` : ""}`),
  productPack: (id) => request(`/product-packs/${id}`),
  updateProductPack: (id, data) => request(`/product-packs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  stats: (from, to) => request(`/stats?from=${from}&to=${to}`)
};