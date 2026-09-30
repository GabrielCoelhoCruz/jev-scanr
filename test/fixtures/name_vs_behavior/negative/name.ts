export function invoiceTotal(rows: { price: number; quantity: number }[]) {
  let sum = 0;
  for (const row of rows) {
    sum += row.price * row.quantity;
  }
  const vat = sum * 0.2;
  return Math.round((sum + vat) * 100) / 100;
}
