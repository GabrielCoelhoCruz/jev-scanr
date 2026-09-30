export function buildReport(rows: string[]) {
  const parsed: { name: string; amount: number }[] = [];
  for (const row of rows) {
    const [name, amount] = row.split(",");
    if (!name || amount === undefined) continue;
    const value = Number(amount);
    if (Number.isNaN(value)) continue;
    parsed.push({ name: name.trim(), amount: value });
  }
  const totals = new Map<string, number>();
  for (const item of parsed) {
    totals.set(item.name, (totals.get(item.name) ?? 0) + item.amount);
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 10);
  const lines: string[] = [];
  lines.push("Name | Total");
  lines.push("--- | ---");
  for (const [name, total] of top) {
    lines.push(`${name} | ${total.toFixed(2)}`);
  }
  const grand = sorted.reduce((sum, entry) => sum + entry[1], 0);
  lines.push("");
  lines.push(`Grand total: ${grand.toFixed(2)}`);
  const shown = top.reduce((sum, entry) => sum + entry[1], 0);
  lines.push(`Shown: ${shown.toFixed(2)} of ${grand.toFixed(2)}`);
  return lines.join("\n");
}
