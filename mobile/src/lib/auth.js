import { Preferences } from "@capacitor/preferences";
import { NativeBiometric } from "capacitor-native-biometric";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import { DB_NAME, closeDatabase, openDatabase } from "../db/index.js";

const KEYS = {
  hash: "auth.pin_hash",
  salt: "auth.pin_salt",
  secret: "auth.db_secret",
  biometric: "auth.biometric",
  createdAt: "auth.created_at"
};

const enc = new TextEncoder();

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function randomHex(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(pin)), "PBKDF2", false, [
    "deriveBits"
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: 120000 },
    key,
    256
  );
  return toHex(bits);
}

async function get(key) {
  const { value } = await Preferences.get({ key });
  return value;
}

async function set(key, value) {
  await Preferences.set({ key, value });
}

async function remove(key) {
  await Preferences.remove({ key });
}

export async function hasPin() {
  return !!(await get(KEYS.hash));
}

export async function hasBiometricEnabled() {
  return (await get(KEYS.biometric)) === "true";
}

/** First-run setup: create the PIN and the SQLCipher secret, then open the DB. */
export async function setupPin(pin) {
  const value = String(pin || "");
  if (!/^\d{6}$/.test(value)) throw new Error("Choose a 6-digit PIN");
  const salt = randomHex(16);
  const secret = randomHex(32);
  await set(KEYS.salt, salt);
  await set(KEYS.hash, await hashPin(value, salt));
  await set(KEYS.secret, secret);
  await set(KEYS.createdAt, new Date().toISOString());
  await openDatabase(secret);
  return true;
}

export async function verifyPin(pin) {
  const salt = await get(KEYS.salt);
  const hash = await get(KEYS.hash);
  const secret = await get(KEYS.secret);
  if (!salt || !hash || !secret) throw new Error("App is not set up yet");
  const attempt = await hashPin(pin, salt);
  if (attempt !== hash) return false;
  await openDatabase(secret);
  return true;
}

export async function changePin(oldPin, newPin) {
  const ok = await verifyPin(oldPin);
  if (!ok) throw new Error("Current PIN is incorrect");
  if (!/^\d{6}$/.test(String(newPin || ""))) throw new Error("Choose a 6-digit PIN");
  const salt = randomHex(16);
  await set(KEYS.salt, salt);
  await set(KEYS.hash, await hashPin(String(newPin), salt));
  return true;
}

export async function biometricAvailable() {
  try {
    const res = await NativeBiometric.isAvailable();
    return !!(res?.isAvailable ?? res);
  } catch {
    return false;
  }
}

export async function enableBiometric() {
  if (!(await biometricAvailable())) throw new Error("No biometric unlock is set up on this device");
  await set(KEYS.biometric, "true");
  return true;
}

export async function disableBiometric() {
  await set(KEYS.biometric, "false");
  return true;
}

/** Prompt for a fingerprint/face and open the DB if the device accepts it. */
export async function unlockWithBiometric() {
  if (!(await hasBiometricEnabled())) throw new Error("Biometric unlock is turned off");
  const secret = await get(KEYS.secret);
  if (!secret) throw new Error("App is not set up yet");
  try {
    await NativeBiometric.verifyIdentity({
      reason: "Unlock Barkaati Inventory",
      title: "Unlock",
      subtitle: "Confirm your identity",
      description: "Use your fingerprint or face to open the shop data.",
      negativeButtonText: "Use PIN"
    });
  } catch (e) {
    throw new Error(e?.message || "Biometric check was cancelled");
  }
  await openDatabase(secret);
  return true;
}

export async function lock() {
  await closeDatabase();
}

/** Wipe the PIN and the encrypted database. Irreversible — used for "forgot PIN". */
export async function resetApp() {
  await closeDatabase();
  try {
    const sql = new SQLiteConnection(CapacitorSQLite);
    await sql.deleteConnection(DB_NAME, false);
  } catch {
    /* ignore */
  }
  try {
    await CapacitorSQLite.deleteDatabase({ database: DB_NAME });
  } catch {
    /* ignore */
  }
  await Preferences.clear();
  return true;
}
