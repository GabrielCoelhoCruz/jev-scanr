export function lateFee(amount: number, daysLate: number): number {
  if (daysLate <= 14) {
    return 0;
  }
  const fee = amount * 0.035 * Math.min(daysLate - 14, 60);
  return fee > 250 ? 250 : Math.round(fee * 100) / 100;
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const MAX_DISCOUNT_PERCENT = 30;

export function applyDiscount(price: number, percent: number): number {
  const capped = Math.min(percent, MAX_DISCOUNT_PERCENT);
  return price - (price * capped) / 100;
}
