const GRACE_PERIOD_DAYS = 14;
const DAILY_RATE = 0.035;
const MAX_LATE_DAYS = 60;
const MAX_FEE = 250;

export function lateFee(amount: number, daysLate: number): number {
  if (daysLate <= GRACE_PERIOD_DAYS) {
    return 0;
  }
  const fee = amount * DAILY_RATE * Math.min(daysLate - GRACE_PERIOD_DAYS, MAX_LATE_DAYS);
  return fee > MAX_FEE ? MAX_FEE : Math.round(fee * 100) / 100;
}
