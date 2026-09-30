export const ORDERS = `export function pendingTotals(orders: Order[], currency: string) {
  const totals = new Map<string, number>();
  for (const order of orders) {
    if (order.status !== "pending") continue;
    const key = order.customerId;
    const amount = convertAmount(order.amount, order.currency, currency);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  const rows = [...totals.entries()].map(([customerId, amount]) => ({
    customerId,
    label: \`\${customerId}: \${formatCurrency(amount, currency)}\`,
  }));
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}
`;
export const INVOICES = `export const outstandingByCustomer = (list: Order[], unit: string) => {
  const sums = new Map<string, number>();
  list.forEach((entry) => {
    if (entry.status !== "pending") return;
    const id = entry.customerId,
      value = convertAmount(entry.amount, entry.currency, unit);
    sums.set(id, (sums.get(id) ?? 0) + value);
  });
  const out = Array.from(sums.entries()).map(function ([customerId, value]) {
    return { customerId: customerId, label: customerId + ": " + formatCurrency(value, unit) };
  });
  return out.sort(function (x, y) {
    return x.label.localeCompare(y.label);
  });
};
`;
export const TAG_COPY = `export const uniqueLowercase = (input: string[]) => {
  const known = new Set<string>();
  return input.reduce<string[]>((acc, raw) => {
    const value = raw.trim().toLowerCase();
    if (!value || known.has(value)) return acc;
    known.add(value);
    acc.push(value);
    return acc;
  }, []);
};
`;
export const OTHER = `export function retryDelays(attempts: number, base: number) {
  const delays: number[] = [];
  let current = base;
  for (let index = 0; index < attempts; index++) {
    delays.push(Math.min(current, 30000));
    current = current * 2;
  }
  if (delays.length === 0) {
    return [base];
  }
  return delays;
}
export function tagList(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const lower = tag.trim().toLowerCase();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    result.push(lower);
  }
  return result;
}
`;

