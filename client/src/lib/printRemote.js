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
