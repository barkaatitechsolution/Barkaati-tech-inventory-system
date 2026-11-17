import { api } from "../api.js";

// Send the receipt to the laptop's printer instead of calling window.print() on
// this device. The phone and the laptop both run the same UI, but only the
// laptop is wired to the Bluetooth thermal printer, so the server does the
// actual printing.
export async function printReceiptOnLaptop(sale, items, storeInfo) {
  return api.printReceipt({
    sale,
    items: Array.isArray(items) ? items : [],
    storeInfo: storeInfo || {}
  });
}

export async function printCustomerCardsOnLaptop(storeInfo, customers, options = {}) {
  return api.printCustomerCards({
    storeInfo: storeInfo || {},
    customers: (Array.isArray(customers) ? customers : []).map((c) => ({
      name: c.name || "",
      phone: c.phone || "",
      barcode: c.barcode || "",
      card_no: c.card_no || "",
      points: Number(c.points) || 0
    })),
    copies: Math.max(1, Number(options.copies) || 1)
  });
}

export async function printSalesCommandLabelOnLaptop(storeInfo, command, options = {}) {
  const code = String(command?.code || "").trim();
  if (!code) throw new Error("Command barcode is missing");
  return api.printBarcodeLabels({
    storeInfo: storeInfo || {},
    products: [
      {
        name: command?.label || code,
        barcode: code
      }
    ],
    copies: Math.max(1, Number(options.copies) || 1)
  });
}

export async function printBarcodeLabelsOnLaptop(storeInfo, products, options = {}) {
  return api.printBarcodeLabels({
    storeInfo: storeInfo || {},
    products: (Array.isArray(products) ? products : []).map((p) => ({
      name: p.name || "",
      barcode: p.barcode || "",
      sku: p.sku || "",
      selling_price: p.selling_price
    })),
    copies: Math.max(1, Number(options.copies) || 1)
  });
}
