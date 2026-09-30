export function summarize(orders: { total: number; refunded: number }[], returns: { total: number; refunded: number }[]) {
  let orderTotal = 0;
  let orderRefunded = 0;
  for (const order of orders) {
    orderTotal += order.total;
    orderRefunded += order.refunded;
  }
  const orderNet = orderTotal - orderRefunded;
  let returnTotal = 0;
  let returnRefunded = 0;
  for (const item of returns) {
    returnTotal += item.total;
    returnRefunded += item.refunded;
  }
  const returnNet = returnTotal - returnRefunded;
  return { orderNet, returnNet };
}
