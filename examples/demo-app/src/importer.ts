export interface OrderRow {
  id: string;
  customer: string;
  cents: number;
}

export async function importOrders(
  csv: string,
  db: { save(row: OrderRow): Promise<void> },
): Promise<string> {
  const rows: OrderRow[] = [];
  for (const line of csv.split("\n")) {
    const [id, customer, cents] = line.split(",");
    if (!id || !customer || cents === undefined) continue;
    const value = Number(cents);
    if (Number.isNaN(value) || value < 0) continue;
    rows.push({ id: id.trim(), customer: customer.trim(), cents: value });
  }
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  for (const row of unique) {
    await db.save(row);
  }
  const totals = new Map<string, number>();
  for (const row of unique) {
    totals.set(row.customer, (totals.get(row.customer) ?? 0) + row.cents);
  }
  const lines: string[] = ["Customer | Total", "--- | ---"];
  for (const [customer, cents] of [...totals.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`${customer} | $${(cents / 100).toFixed(2)}`);
  }
  const grand = unique.reduce((sum, row) => sum + row.cents, 0);
  lines.push("");
  lines.push(`Imported ${unique.length} orders, $${(grand / 100).toFixed(2)}`);
  return lines.join("\n");
}
