export function find(items: { tags: string[]; active: boolean }[], tag: string) {
  return items.filter((item) => item.active && item.tags.includes(tag));
}
