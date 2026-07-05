const defaultCurrencyCode = "USD";
const mixedCurrencyCode = "MIXED";

const currencyCodePattern = /^[A-Z]{3}$/;
const currencySymbols: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY"
};

export function normalizeCurrencyCode(value: string | null | undefined, fallback?: string): string | undefined {
  const normalized = value?.trim().toUpperCase();

  if (normalized && currencyCodePattern.test(normalized)) {
    return normalized;
  }

  return fallback && currencyCodePattern.test(fallback) ? fallback : undefined;
}

export function normalizeProviderCurrencyCode(value: string | null | undefined): string {
  return normalizeCurrencyCode(value, defaultCurrencyCode) ?? defaultCurrencyCode;
}

function commonCurrencyCode(currencies: Array<string | null | undefined>): string | undefined {
  const normalizedCurrencies = currencies.flatMap((currency) => {
    const normalized = normalizeCurrencyCode(currency);
    return normalized ? [normalized] : [];
  });
  const uniqueCurrencies = new Set(normalizedCurrencies);

  return uniqueCurrencies.size === 1 ? normalizedCurrencies[0] : undefined;
}

export function displayCurrencyCode(currencies: Array<string | null | undefined>, fallback = defaultCurrencyCode): string {
  const normalizedCurrencies = currencies.flatMap((currency) => {
    const normalized = normalizeCurrencyCode(currency);
    return normalized ? [normalized] : [];
  });

  if (normalizedCurrencies.length === 0) {
    return fallback;
  }

  return commonCurrencyCode(normalizedCurrencies) ?? mixedCurrencyCode;
}

export function inferCurrencyCodeFromText(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const code = value.match(/\b[A-Z]{3}\b/i)?.[0];
  const normalized = normalizeCurrencyCode(code);

  if (normalized) {
    return normalized;
  }

  for (const [symbol, currency] of Object.entries(currencySymbols)) {
    if (value.includes(symbol)) {
      return currency;
    }
  }

  return undefined;
}
