import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";

export function normalisePhone(phone, countryCode = "91") {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `${countryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `${countryCode}${digits.slice(1)}`;
  return digits;
}

export function whatsappUrl(phone, text) {
  const number = normalisePhone(phone);
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return number ? `https://wa.me/${number}${query}` : `https://wa.me/${query}`;
}

export function smsUrl(phone, text) {
  const number = String(phone || "").replace(/[^\d+]/g, "");
  const query = text ? `?body=${encodeURIComponent(text)}` : "";
  return `sms:${number}${query}`;
}

export function mailtoUrl(email, subject, body) {
  const parts = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${String(email || "")}${parts.length ? `?${parts.join("&")}` : ""}`;
}

export async function openUrl(url) {
  if (!url) return false;
  try {
    if (Capacitor.isNativePlatform()) {
      window.open(url, "_system");
    } else {
      window.location.href = url;
    }
    return true;
  } catch {
    return false;
  }
}

export async function shareText({ title = "", text = "", url = "", dialogTitle = "" } = {}) {
  const payload = { title, text, url, dialogTitle: dialogTitle || title || "Share" };
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share(payload);
      return { shared: true, method: "native" };
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, text, url });
      return { shared: true, method: "web" };
    }
  } catch (e) {
    if (e && e.message && /cancel/i.test(e.message)) return { shared: false, cancelled: true };
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText([text, url].filter(Boolean).join("\n"));
      return { shared: false, copied: true };
    }
  } catch {
    /* ignore */
  }
  return { shared: false };
}

export async function shareToWhatsApp(phone, text) {
  const url = whatsappUrl(phone, text);
  if (Capacitor.isNativePlatform()) {
    const opened = await openUrl(url);
    if (opened) return { opened: true, method: "whatsapp" };
  }
  return shareText({ title: "WhatsApp", text });
}

export async function shareToSms(phone, text) {
  const url = smsUrl(phone, text);
  if (Capacitor.isNativePlatform()) {
    const opened = await openUrl(url);
    if (opened) return { opened: true, method: "sms" };
  }
  return shareText({ title: "SMS", text });
}

export async function shareToEmail(email, subject, body) {
  const url = mailtoUrl(email, subject, body);
  if (Capacitor.isNativePlatform()) {
    const opened = await openUrl(url);
    if (opened) return { opened: true, method: "email" };
  }
  return shareText({ title: subject, text: body });
}

export function fillTemplate(template, vars = {}) {
  return String(template || "").replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (m, key) => {
    const value = vars[key];
    return value === undefined || value === null ? m : String(value);
  });
}
