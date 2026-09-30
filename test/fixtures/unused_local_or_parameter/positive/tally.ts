export function tally(values: number[], label: string, verbose: boolean): number {
  const started = Date.now();
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}
