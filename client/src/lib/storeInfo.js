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
  return info;
}

export function saveStoreInfo(info) {
  localStorage.setItem(KEY, JSON.stringify(info || {}));
}