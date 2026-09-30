export function statusColor(status: string): string {
  const fallback = "#888888";
  switch (status) {
    case "ok":
      return "#2e7d32";
    case "warning":
      return "#ed6c02";
    case "error":
      return "#d32f2f";
    default:
      return fallback;
  }
}
