// Money lives as integer cents in code and as "123.45" strings at the PayPal boundary.
const AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

// The PayPal JS SDK is loaded for one currency per page, so the prototype sticks to USD.
export const SUPPORTED_CURRENCIES = ['USD'];

export function toCents(value) {
  const text = String(value ?? '').trim();
  if (!AMOUNT_PATTERN.test(text)) throw new RangeError(`"${text}" is not a valid amount`);
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function fromCents(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// Decides how a release request maps onto a PayPal capture. The AI may later
// propose the amount, but this check is the last word on what money moves.
export function planRelease(milestone, requestedAmount) {
  if (milestone.status !== 'funded') {
    throw new RangeError(`Only a funded milestone can be released (this one is ${milestone.status})`);
  }
  const authorized = toCents(milestone.amount);
  const cents = requestedAmount === undefined || requestedAmount === null || requestedAmount === ''
    ? authorized
    : toCents(requestedAmount);
  if (cents <= 0) throw new RangeError('Release amount must be more than zero');
  if (cents > authorized) throw new RangeError(`Release amount ${fromCents(cents)} is more than the ${milestone.amount} held`);
  return {
    amount: fromCents(cents),
    partial: cents < authorized,
    returnedToClient: fromCents(authorized - cents),
  };
}
