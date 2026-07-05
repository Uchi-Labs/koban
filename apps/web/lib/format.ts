import { normalizeCurrencyCode } from "@/lib/currency";

export function formatCurrency(amount: number, currency = "USD") {
  const normalizedCurrency = normalizeCurrencyCode(currency);

  if (!normalizedCurrency) {
    const formattedAmount = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2
    }).format(amount);

    return `${formattedAmount} ${currency}`;
  }

  return new Intl.NumberFormat("en-US", {
    currency: normalizedCurrency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    style: "currency"
  }).format(amount);
}
