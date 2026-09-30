const STOPWORDS = new Set(
  "the and for with from into that this then than get set has have are was use used make made create new add all any not out off its per via run handle on of to in is it as at by do to if or an a can has own one two index item items data value values result results default props prop state args arg params param options option opts config ctx context".split(
    " ",
  ),
);

const splitWords = (text) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) =>
      w.length > 4 && w.endsWith("ies")
        ? w.slice(0, -3) + "y"
        : w.length > 3 && w.endsWith("s")
          ? w.slice(0, -1)
          : w,
    )
    .filter((w) => !STOPWORDS.has(w));

export const nameWords = (name) => new Set(splitWords(name));

export function nameCue(index, f, name = f.name) {
  const words = name ? [...nameWords(name)].sort() : [];
  if (!words.length) return { words, absent: false };
  const { source } = index.modules.get(f.path),
    label = f.node.id ?? f.node.key,
    text =
      label && label.start >= f.node.start && label.end <= f.node.end
        ? source.slice(f.node.start, label.start) +
          source.slice(label.end, f.node.end)
        : source.slice(f.node.start, f.node.end),
    body = new Set(splitWords(text));
  return { words, absent: words.every((w) => !body.has(w)) };
}
