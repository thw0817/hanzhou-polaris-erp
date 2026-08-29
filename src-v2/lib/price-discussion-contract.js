function dimensionFrom(values) {
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || "").trim();
    const match = value.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i);
    if (!match) continue;
    const unit = (match[2] || match[4] || "cm").toLowerCase();
    const toMeters = (amount, itemUnit) => {
      if (itemUnit === "m") return amount;
      if (itemUnit === "mm") return amount / 1000;
      return amount / 100;
    };
    const widthMeters = toMeters(Number(match[1]), (match[2] || unit).toLowerCase());
    const lengthMeters = toMeters(Number(match[3]), (match[4] || unit).toLowerCase());
    if (widthMeters > 0 && lengthMeters > 0) {
      return { widthMeters, lengthMeters };
    }
  }
  return null;
}

function compactNumber(value) {
  return Number(value.toFixed(2)).toString();
}

export function skuSizeLabel(values) {
  const dimension = dimensionFrom(values);
  if (dimension) {
    return `${compactNumber(dimension.widthMeters * 100)} × ${compactNumber(dimension.lengthMeters * 100)} cm`;
  }
  const labels = (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return labels.join(" / ") || "未返回尺寸";
}

export function pricePerSquareMeter(price, values) {
  const amount = Number(price);
  const dimension = dimensionFrom(values);
  if (!Number.isFinite(amount) || amount < 0 || !dimension) return null;
  const area = dimension.widthMeters * dimension.lengthMeters;
  return area > 0 ? Math.round((amount / area) * 100) / 100 : null;
}

export function formatDiscussionMoney(value, currency) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const unit = String(currency || "").trim().toUpperCase();
  return unit === "CNY" ? `${amount.toFixed(2)} 元` : `${amount.toFixed(2)}${unit ? ` ${unit}` : ""}`;
}
