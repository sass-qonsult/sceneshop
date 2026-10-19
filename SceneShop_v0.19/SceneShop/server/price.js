"use strict";
/**
 * Preços em reais digitados no padrão brasileiro (1.250.000,00) ou como número (1250000.5).
 * Sem teto comercial: o único limite é o do banco, NUMERIC(14,2) = 999.999.999.999,99.
 */
const MAX_PRICE = 999999999999.99;

function parsePrice(v) {
  if (typeof v === "number") return v;
  let raw = String(v ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!raw) return NaN;
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");          // 1.299,90
  else if ((raw.match(/\./g) || []).length > 1) raw = raw.replace(/\./g, "");      // 1.250.000
  else if (/^\d{1,3}\.\d{3}$/.test(raw)) raw = raw.replace(".", "");               // 1.250 (mil e duzentos e cinquenta)
  return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
}

const validPrice = (n) => Number.isFinite(n) && n > 0 && n <= MAX_PRICE;

module.exports = { parsePrice, validPrice, MAX_PRICE };
