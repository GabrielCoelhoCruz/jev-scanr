export interface Group {
  items: { tags: string[]; active: boolean }[];
}

export function findTagged(groups: Group[], tag: string) {
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

export function activeWithTag(
  items: { tags: string[]; active: boolean }[],
  tag: string,
) {
  return items.filter((item) => item.active && item.tags.includes(tag));
}
