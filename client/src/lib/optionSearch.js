const normalized = (value) => String(value ?? "").trim().toLowerCase();

export function optionKeywords(option) {
  return Array.isArray(option?.keywords) ? option.keywords : [];
}

export function optionSearchText(option) {
  const text = option?.searchText ?? option?.label;
  return [text, ...optionKeywords(option)]
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "")
    .map((part) => String(part).toLowerCase())
    .join(" ");
}

export function exactOption(options, query) {
  const q = normalized(query);
  if (!q) return null;
  return (
    (options || []).find((option) =>
      optionKeywords(option).some((keyword) => normalized(keyword) === q)
    ) || null
  );
}

export function filterOptions(options, query) {
  const list = Array.isArray(options) ? options : [];
  const q = normalized(query);
  if (!q) return list;
  const matches = list.filter((option) => optionSearchText(option).includes(q));
  const exact = matches.filter((option) =>
    optionKeywords(option).some((keyword) => normalized(keyword) === q)
  );
  if (exact.length === 0) return matches;
  const exactSet = new Set(exact);
  return [...exact, ...matches.filter((option) => !exactSet.has(option))];
}

export function looksLikeBarcode(value) {
  return /^\S{4,}$/.test(String(value ?? "").trim());
}

const scanCandidate = (value) =>
  String(value ?? "")
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .replace(/^\][A-Z]\d/i, "");

export function looksLikeScanCode(value) {
  const code = scanCandidate(value);
  if (!code || /\s/.test(code)) return false;
  return (
    /^(CT|BT|WT:|CMD:)/i.test(code) ||
    /^\d{4,14}$/.test(code) ||
    /^[A-Z0-9:_-]{8,}$/i.test(code)
  );
}

export function looksLikeGlobalScanCode(value) {
  const code = scanCandidate(value);
  if (!code || /\s/.test(code)) return false;
  return /^(CT|BT|WT:|CMD:)/i.test(code);
}
