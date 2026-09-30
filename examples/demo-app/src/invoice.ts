export interface InvoiceLine {
  description: string;
  quantity: number;
  unitCents: number;
}

export function renderInvoiceText(
  number: string,
  customer: string,
  lines: InvoiceLine[],
): string {
  const out: string[] = [];
  out.push(`Invoice ${number}`);
  out.push(`Customer: ${customer}`);
  out.push("");
  out.push("Item | Qty | Unit | Amount");
  out.push("--- | --- | --- | ---");
  let total = 0;
  for (const line of lines) {
    const amount = line.quantity * line.unitCents;
    total += amount;
    const unit = (line.unitCents / 100).toFixed(2);
    out.push(
      `${line.description} | ${line.quantity} | $${unit} | $${(amount / 100).toFixed(2)}`,
    );
  }
  out.push("");
  out.push(`Total: $${(total / 100).toFixed(2)}`);
  return out.join("\n");
}
