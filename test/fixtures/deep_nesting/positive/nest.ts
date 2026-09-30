export function find(groups: { items: { tags: string[]; active: boolean }[] }[], tag: string) {
  const found: unknown[] = [];
  for (const group of groups) {
    if (group.items.length > 0) {
      for (const item of group.items) {
        if (item.active) {
          for (const candidate of item.tags) {
            if (candidate === tag) {
              found.push(item);
            }
          }
        }
      }
    }
  }
  return found;
}
