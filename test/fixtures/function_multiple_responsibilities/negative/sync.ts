export function displayName(raw: { first_name: string; last_name: string }): string {
  return `${raw.first_name} ${raw.last_name}`.trim();
}
