export function statusLabel(status: string): string {
  const fallback = "Unknown";
  switch (status) {
    case "ok":
      return "All good";
    case "warning":
      return "Needs attention";
    case "error":
      return "Failed";
    default:
      return fallback;
  }
}
