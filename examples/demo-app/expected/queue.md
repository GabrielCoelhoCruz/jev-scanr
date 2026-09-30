# Refactor queue

4 worth a look, 1 uncertain (check), 24 below the band. Each item is a hypothesis from one Jev answer about one narrow question. It is not a bug report, and P is not the chance that a change is worth making.

**How to use this file.** Hand it to a person or a coding agent. For each item, read the listed lines, answer the question yourself, and change nothing if it does not hold. `no change` is a valid outcome. Verify before editing. Signals marked *experimental* have too little evidence to trust; see EVIDENCE.md.

**Worth a look (4).** Candidates at or above each signal's cut, ordered by Jev's probability for the positive option (highest first).

## 1. clampPercent src/percent.ts:1–14 ↔ clampVolume src/volume.ts:1–14 · clone_same_policy@3.0.0 · P=0.98

- **Question:** Do the sections labeled pair.a and pair.b implement the same kind of policy or operation, after accounting for visible types, callees and callers? Mere normalized shape, similar names or interchangeable literals are not enough.
- **Jev answer:** same_policy.
- **Read first:** src/percent.ts:1–14; src/volume.ts:1–14.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

## 2. importOrders src/importer.ts:7–42 · function_should_split@1.0.0 · P=0.90

- **Question:** Is the section labeled focus long or dense enough that a reader must track many distinct steps, and do cohesive visible blocks exist that could each stand as a separately named function? Length alone is not enough; name the blocks in your reasoning.
- **Jev answer:** split_candidate.
- **Read first:** src/importer.ts:7–42; src/importer.ts:1–5.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

## 3. importOrders src/importer.ts:7–42 · function_multiple_responsibilities@1.0.0 · P=0.88

- **Question:** Does the section labeled focus perform two or more separable responsibilities (for example fetching, transforming, persisting and presenting data) that are not coordinated by one stated purpose? Judge the visible body only.
- **Jev answer:** multiple.
- **Read first:** src/importer.ts:7–42; src/importer.ts:1–5.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

## 4. registerUser src/signup.ts:1–27 · function_multiple_responsibilities@1.0.0 · P=0.78

- **Question:** Does the section labeled focus perform two or more separable responsibilities (for example fetching, transforming, persisting and presenting data) that are not coordinated by one stated purpose? Judge the visible body only.
- **Jev answer:** multiple.
- **Read first:** src/signup.ts:1–27.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

---

**Uncertain, check (1).** P is at or above the signal's floor and under its cut: Jev leaned toward the positive option, not enough to rank with the list above. Read these after the first list, and expect more `no change` outcomes. In the evaluation samples an LLM reviewer judged some cells just under the cut worth a change, at a lower rate than above it (docs/BANDS.md).

### 5. registerUser src/signup.ts:1–27 · function_should_split@1.0.0 · P=0.52 · uncertain

- **Question:** Is the section labeled focus long or dense enough that a reader must track many distinct steps, and do cohesive visible blocks exist that could each stand as a separately named function? Length alone is not enough; name the blocks in your reasoning.
- **Jev answer:** split_candidate.
- **Read first:** src/signup.ts:1–27.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

---

**Below the band (24).** 24 scored cells are under their signal's floor. They are not listed here. Each one is in report.json (`blocks[].signals[]` with `band: "below"`).
