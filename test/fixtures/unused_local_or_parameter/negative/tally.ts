export function tally(values: number[], label: string): string {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return `${label}: ${total}`;
}
