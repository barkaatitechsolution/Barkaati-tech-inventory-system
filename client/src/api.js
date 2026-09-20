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
  supplierPurchases: () => request("/supplier-purchases"),
  supplierPurchase: (id) => request(`/supplier-purchases/${id}`),
  createSupplierPurchase: (data) => request("/supplier-purchases", { method: "POST", body: JSON.stringify(data) }),
  updateSupplierPurchase: (id, data) => request(`/supplier-purchases/${id}`, { method: "PUT", body: JSON.stringify(data) }),
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
  assets: () => request("/assets"),
  createAsset: (data) => request("/assets", { method: "POST", body: JSON.stringify(data) }),
  updateAsset: (id, data) => request(`/assets/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAsset: (id) => request(`/assets/${id}`, { method: "DELETE" }),
  expenses: () => request("/expenses"),
  createExpense: (data) => request("/expenses", { method: "POST", body: JSON.stringify(data) }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: "DELETE" }),
  measuringUnits: () => request("/measuring-units"),
  measuringUnit: (id) => request(`/measuring-units/${id}`),
  createMeasuringUnit: (data) => request("/measuring-units", { method: "POST", body: JSON.stringify(data) }),
  updateMeasuringUnit: (id, data) => request(`/measuring-units/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMeasuringUnit: (id) => request(`/measuring-units/${id}`, { method: "DELETE" }),
  productPacks: (productId) => request(`/product-packs${productId ? `?product_id=${productId}` : ""}`),
  productPack: (id) => request(`/product-packs/${id}`),
  updateProductPack: (id, data) => request(`/product-packs/${id}`, { method: "PUT", body: JSON.stringify(data) })
};