import { useEffect, useState } from "react";
import { api } from "../api.js";

const KEY = "storemaster_store_info";
const DEFAULT_NAME = "Royal Spicy Masala";

const FIELDS = [
  "name",
  "address",
  "phone",
  "logo",
  "qrCode",
  "taxNo",
  "bankHolder",
  "bankName",
  "bankAccountNo",
  "ifsc",
  "footerText"
];

// In-memory copy so getStoreInfo() can stay synchronous. Every caller reads it
// during render -- receipts, quotations, vouchers, WhatsApp messages -- and
// turning it into an async call would ripple through all of them.
let cache = readLocal();

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function normalize(info) {
  const out = { ...(info || {}) };
  if (!out.name || out.name.trim() === "" || out.name === "StoreMaster") {
    out.name = DEFAULT_NAME;
  }
  for (const key of FIELDS) {
    if (key !== "name") out[key] = out[key] || "";
  }
  return out;
}

function persist(info) {
  cache = normalize(info);
  // Kept as a first-paint seed only; the database is the source of truth, so a
  // second device in the shop no longer prints a different header.
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota or private mode -- the server copy still has it */
  }
  emit();
  return cache;
}

// The module cache is plain JavaScript, so React has no way to notice it
// changed. Components that display the shop name subscribe to this and re-render
// when it is saved or when another device changes it.
const listeners = new Set();

export function subscribeStoreInfo(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  if (!listeners.size) return;
  const snapshot = getStoreInfo();
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      /* one bad subscriber must not block the rest */
    }
  }
}

export function getStoreInfo() {
  return normalize(cache);
}

// Pull the shop's details from the server. Safe to call repeatedly; the
// response is cached like every other GET, so a re-render costs nothing.
export async function loadStoreInfo({ force = false } = {}) {
  try {
    const fresh = await api.storeInfo({ fresh: force });
    return persist(fresh);
  } catch {
    return getStoreInfo();
  }
}

// Updates the local copy immediately (so the UI reflects the edit without
// waiting on the round trip) then persists to the database.
export async function saveStoreInfo(info) {
  const next = persist(info);
  await api.saveStoreInfo(next);
  return next;
}

// React hook for anything that displays the shop's details. Re-renders on save
// and when another tab or device changes them.
export function useStoreInfo() {
  const [info, setInfo] = useState(getStoreInfo);
  useEffect(() => subscribeStoreInfo(setInfo), []);
  return info;
}
