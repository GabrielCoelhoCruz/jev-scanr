export function clampVolume(level: number): number {
  const lowest = 0;
  const highest = 10;
  if (Number.isNaN(level)) {
    return lowest;
  }
  if (level < lowest) {
    return lowest;
  }
  if (level > highest) {
    return highest;
  }
  return Math.round(level);
}
