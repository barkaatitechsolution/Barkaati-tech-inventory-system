// Phone numbers, SMS and email for the broadcast pages.
//
// The shop is in India, so a bare 10-digit mobile is the normal thing typed into
// the customer form, while every channel wants it in international form. That
// conversion lives here, once, because WhatsApp, SMS and email all have to agree
// on it -- a number that reaches one channel as 9876543210 and another as
// 919876543210 is a support call waiting to happen.

const DEFAULT_COUNTRY_CODE = "91";

// Strips everything that is not a digit and puts the number in international
// form. A leading 0 is dropped (Indian trunk prefix) and a bare 10-digit mobile
// gets the country code added. Anything already carrying a code is left alone,
// and a number that cannot be salvaged comes back as an empty string so callers
// can treat "unusable" as falsy instead of dialling a broken link.
export function normalizePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = DEFAULT_COUNTRY_CODE + digits;
  return digits;
}

// True when the number is long enough to be a real phone number. 10 digits after
// the trunk prefix is the shortest thing worth dialling; anything shorter is a
// half-typed entry in the customer list rather than a contact.
export function isUsablePhone(raw) {
  return normalizePhone(raw).length >= 10;
}

// ── SMS ─────────────────────────────────────────────────────

// A single SMS is 160 characters of GSM-7 text. Past that the phone splits the
// message and the operator charges for -- and the handset sends -- each part, so
// crossing the line roughly doubles the cost of one message. These are the two
// numbers that decide it: 160 for the first part, 153 for each one after.
const SMS_SINGLE_LIMIT = 160;
const SMS_MULTI_PART = 153;

// Exported for the broadcast page, which warns about the 160-character line in
// its own copy so the advice and the maths can never disagree.
export { SMS_SINGLE_LIMIT };

// How many SMS parts this text will actually be sent as.
//
// The count is character based, which is right for plain text and slightly
// optimistic for anything containing an emoji or an Indic character -- those
// fall back to UCS-2 and get packed fewer per message. The page only uses this
// to warn that a message will cost more than one part, so a character estimate
// that errs low is safer than one that errs high.
export function smsParts(text) {
  const len = String(text || "").length;
  if (len === 0) return 0;
  if (len <= SMS_SINGLE_LIMIT) return 1;
  return 1 + Math.ceil((len - SMS_SINGLE_LIMIT) / SMS_MULTI_PART);
}

// Hands the message to whatever SMS app the shop's computer or phone uses,
// already addressed and pre-filled. There is no SMS provider here on purpose:
// this opens the shopkeeper's own app so the message goes out on their existing
// number and SIM, with no account, no key and no per-message billing.
//
// Falls back to an empty recipient when the number is unusable, which still
// opens a blank compose window -- that is more use than handing back nothing,
// since the shopkeeper can paste in a number that was mistyped.
export function openSmsApp(text, phone) {
  const to = normalizePhone(phone);
  window.open(`sms:${to}?body=${encodeURIComponent(text || "")}`, "_blank", "noopener");
}

// ── Email ───────────────────────────────────────────────────

// Deliberately loose. The only thing that matters is that the string has
// something before an "@", something after it, and no spaces -- a stricter regex
// would reject addresses that work perfectly well while passing nothing that
// fails, because the only way to know an address is real is to send to it.
export function isUsableEmail(raw) {
  const v = String(raw || "").trim();
  if (!v || /\s/.test(v)) return false;
  const at = v.indexOf("@");
  return at > 0 && at < v.length - 1 && v.indexOf("@", at + 1) === -1 && v.includes(".");
}

// Hands the message to the shop's default mail client. Same reasoning as SMS:
// the shop's own Outlook/Thunderbird sends it, so nothing here needs a mail
// server and no copy of the customer's list ever leaves the machine.
export function openMailApp({ to, subject, body }) {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  params.set("body", body || "");
  window.open(`mailto:${String(to || "").trim()}?${params.toString()}`, "_blank", "noopener");
}

// Mail clients are the least consistent part of this whole feature: several of
// them silently truncate a mailto: URL a couple of thousand characters in, and
// a truncated offer is worse than no offer because the shopkeeper cannot tell it
// happened. Past this length the page says to send from the mail app instead.
export const MAILTO_SAFE_CHARS = 1800;

export function mailtoLength({ to, subject, body }) {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  params.set("body", body || "");
  return `mailto:${String(to || "").trim()}?${params.toString()}`.length;
}