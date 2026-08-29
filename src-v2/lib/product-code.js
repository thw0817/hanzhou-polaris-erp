function formatTwoDigits(value) {
  return String(value).padStart(2, "0");
}

export function normalizeSupplierCode(value) {
  return String(value || "")
    .trim()
    .replace(/[、，,]+/g, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

export function defaultSupplierCode(path = [], sequence = 1, now = new Date()) {
  const parts = (Array.isArray(path) ? path : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(-2);
  const categoryPart = normalizeSupplierCode(parts.length ? parts.join("-") : "商品") || "商品";
  const safeSequence = Math.min(999, Math.max(1, Number(sequence) || 1));
  const datePart = `${formatTwoDigits(now.getMonth() + 1)}${formatTwoDigits(now.getDate())}`;
  return normalizeSupplierCode(`${categoryPart}-${datePart}${String(safeSequence).padStart(3, "0")}`);
}
