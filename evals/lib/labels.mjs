export const LABELS = ["actionable", "no_action", "uncertain"];
export const key = (cardId, signalId) => `${cardId}|${signalId}`;

export function normalizeLabels(file, { model = null } = {}) {
  const rows = [];
  let type;
  let who;
  if (file?.schema === "blind-relational-reference/1") {
    type = "llm_reviewer";
    who = model ?? file.reviewer ?? "unknown";
    for (const card of file.cards)
      for (const e of card.evaluations)
        rows.push({
          cardId: card.cardId,
          signalId: e.signalId,
          label: e.label,
          note: e.rationale,
        });
  } else if (file?.schema === "human-labels/1") {
    type = "human";
    who = file.labeler;
    for (const l of file.labels)
      rows.push({
        cardId: l.cardId,
        signalId: l.signalId,
        label: l.label,
        note: l.note,
      });
  } else if (file?.schema === "eval-labels/1") {
    type = file.sourceType;
    who = file.who;
    for (const l of file.labels) rows.push(l);
  } else throw Error("Unknown label file schema");
  if (!["human", "llm_reviewer", "author"].includes(type))
    throw Error("Label source type must be human, llm_reviewer or author");
  if (typeof who !== "string" || !who.trim())
    throw Error("Label file must say who labeled (person, or reviewer model)");
  const labels = new Map();
  let unlabeled = 0;
  for (const r of rows) {
    if (r.label === "" || r.label === null || r.label === undefined) {
      unlabeled++;
      continue;
    }
    if (!LABELS.includes(r.label)) throw Error(`Invalid label: ${r.label}`);
    const k = key(r.cardId, r.signalId);
    if (labels.has(k)) throw Error("Duplicate label row");
    labels.set(k, { label: r.label, note: r.note ?? null });
  }
  return { source: { type, who }, labels, unlabeled };
}
