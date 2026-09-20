const KEY = "storemaster_store_info";

const DEFAULT_NAME = "Royal Spicy Masala";

export function getStoreInfo() {
  let info = {};
  try {
    info = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    info = {};
  }
  if (!info.name || info.name.trim() === "" || info.name === "StoreMaster") {
    info.name = DEFAULT_NAME;
  }
  info.logo = info.logo || "";
  info.qrCode = info.qrCode || "";
  info.taxNo = info.taxNo || "";
  info.bankHolder = info.bankHolder || "";
  info.bankName = info.bankName || "";
  info.bankAccountNo = info.bankAccountNo || "";
  info.ifsc = info.ifsc || "";
  info.footerText = info.footerText || "";
  return info;
}

export function saveStoreInfo(info) {
  localStorage.setItem(KEY, JSON.stringify(info || {}));
}