export function clampPercent(value: number): number {
  const lowest = 0;
  const highest = 100;
  if (Number.isNaN(value)) {
    return lowest;
  }
  if (value < lowest) {
    return lowest;
  }
  if (value > highest) {
    return highest;
  }
  return Math.round(value);
}
