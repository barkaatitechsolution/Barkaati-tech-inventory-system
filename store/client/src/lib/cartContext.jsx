import { createContext, useContext, useEffect, useState } from "react";

const CartContext = createContext(null);
const MAX_QTY = 999;
const STORAGE_KEY = "barkaati-store-cart-v1";

function sanitizeItem(item) {
  const id = Number(item?.id);
  const qty = Math.min(MAX_QTY, Math.max(1, Math.floor(Number(item?.qty) || 0)));
  if (!id || !Number.isFinite(qty)) return null;
  return {
    id,
    name: String(item?.name || "Item"),
    unit: String(item?.unit || "pcs"),
    unit_price: Number(item?.unit_price) || 0,
    images: Array.isArray(item?.images)
      ? item.images.filter((img) => img && img.url).map((img) => ({ id: img.id, url: img.url }))
      : [],
    qty
  };
}

function loadCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeItem).filter(Boolean);
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(loadCart);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* private mode or storage disabled — the cart still works in memory */
    }
  }, [items]);

  const add = (product, qty = 1) => {
    const id = Number(product.id);
    const name = String(product.name || "Item");
    const unit = String(product.unit || "pcs");
    const selling = Number(product.selling_price) || 0;
    const disc = Number(product.discount) || 0;
    const tax = Number(product.tax) || 0;
    const taxable = Math.max(0, selling - disc);
    const unitPrice = Math.round((taxable + (taxable * tax) / 100) * 100) / 100;
    const images = Array.isArray(product.images) ? product.images : [];

    setItems((current) => {
      const existing = current.find((i) => Number(i.id) === id);
      if (existing) {
        const nextQty = Math.min(MAX_QTY, Number(existing.qty) + (Number(qty) || 1));
        return current.map((i) => (Number(i.id) === id ? { ...i, qty: nextQty } : i));
      }
      return [
        ...current,
        {
          id,
          name,
          unit,
          unit_price: unitPrice,
          images,
          qty: Math.min(MAX_QTY, Math.max(1, Math.floor(Number(qty) || 1)))
        }
      ];
    });
  };

  const setQty = (id, qty) => {
    const next = Math.min(MAX_QTY, Math.max(1, Math.floor(Number(qty) || 1)));
    setItems((current) =>
      current.map((i) => (Number(i.id) === Number(id) ? { ...i, qty: next } : i))
    );
  };

  const remove = (id) =>
    setItems((current) => current.filter((i) => Number(i.id) !== Number(id)));

  const clear = () => setItems([]);

  const subtotal = items.reduce((a, i) => a + Number(i.unit_price) * Number(i.qty), 0);

  return (
    <CartContext.Provider value={{ items, add, setQty, remove, clear, subtotal }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
