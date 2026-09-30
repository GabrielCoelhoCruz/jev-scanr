export function parseDuration(entries: { price: number; quantity: number }[]) {
  let total = 0;
  for (const entry of entries) {
    total += entry.price * entry.quantity;
  }
  const tax = total * 0.2;
  return Math.round((total + tax) * 100) / 100;
}
