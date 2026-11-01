export const toCents = (amount) => Math.round(Number(amount || 0) * 100);
export const fromCents = (cents) => (cents / 100).toFixed(2);

const formatters = {};

export function formatMoney(amount, currency = 'USD') {
  formatters[currency] ??= new Intl.NumberFormat(undefined, { style: 'currency', currency });
  return formatters[currency].format(Number(amount || 0));
}
