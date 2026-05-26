const Currency = require('../models/Currency');

const BASE_CURRENCY = 'AED';

/**
 * Load exchange rates: 1 unit of currency = aedRate AED
 */
async function loadCurrencyRates() {
  const rates = { [BASE_CURRENCY]: 1 };
  try {
    const docs = await Currency.find({ isDeleted: false, status: { $ne: false } })
      .select('currencyCode aedRate')
      .lean();
    for (const d of docs || []) {
      const code = String(d.currencyCode || '').trim().toUpperCase();
      const rate = Number(d.aedRate);
      if (code && Number.isFinite(rate) && rate > 0) {
        rates[code] = rate;
      }
    }
  } catch (err) {
    console.warn('loadCurrencyRates fallback:', err.message);
  }
  return rates;
}

function convertFromAed(amountAed, targetCurrencyCode, ratesByCode = {}) {
  const aed = Number(amountAed);
  if (!Number.isFinite(aed)) return 0;
  const code = String(targetCurrencyCode || BASE_CURRENCY).trim().toUpperCase();
  if (code === BASE_CURRENCY) return aed;
  const rate = Number(ratesByCode[code]);
  if (!Number.isFinite(rate) || rate <= 0) return aed;
  return aed / rate;
}

function formatInrAmount(n, { forPdf = false, minimumFractionDigits = 0, maximumFractionDigits = 2 } = {}) {
  const opts = { minimumFractionDigits, maximumFractionDigits };
  const numberPart = n.toLocaleString('en-IN', opts);

  // PDF built-in fonts (Helvetica) often cannot render ₹ (U+20B9)
  if (forPdf) {
    return `INR ${numberPart}`;
  }

  try {
    const formatted = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      ...opts
    }).format(n);
    if (formatted.includes('₹')) return formatted;
    return `INR ${numberPart}`;
  } catch (_) {
    return `INR ${numberPart}`;
  }
}

/**
 * Format an amount stored in AED for display in target currency (PDF / API).
 * @param {{ forPdf?: boolean }} options - Use forPdf for invoice PDFs (ASCII-safe INR).
 */
function formatMoneyFromAed(amountAed, targetCurrencyCode = BASE_CURRENCY, ratesByCode = {}, options = {}) {
  const code = String(targetCurrencyCode || BASE_CURRENCY).trim().toUpperCase();
  const converted = convertFromAed(amountAed, code, ratesByCode);
  if (!Number.isFinite(converted)) return '—';

  const { forPdf = false, minimumFractionDigits = 0, maximumFractionDigits = 2 } = options;

  if (code === 'INR') {
    return formatInrAmount(converted, { forPdf, minimumFractionDigits, maximumFractionDigits });
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits,
      maximumFractionDigits
    }).format(converted);
  } catch (_) {
    return `${code} ${converted.toLocaleString('en-US', {
      minimumFractionDigits,
      maximumFractionDigits
    })}`;
  }
}

module.exports = {
  BASE_CURRENCY,
  loadCurrencyRates,
  convertFromAed,
  formatMoneyFromAed,
  formatInrAmount
};
