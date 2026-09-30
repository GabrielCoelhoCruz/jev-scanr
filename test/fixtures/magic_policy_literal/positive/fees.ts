export function lateFee(amount: number, daysLate: number): number {
  if (daysLate <= 14) {
    return 0;
  }
  const fee = amount * 0.035 * Math.min(daysLate - 14, 60);
  return fee > 250 ? 250 : Math.round(fee * 100) / 100;
}
