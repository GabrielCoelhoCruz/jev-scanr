# Refactor queue

7 candidates at or above each signal's display cut, ordered by Jev's probability for the positive option (highest first). Each item is a hypothesis from one Jev answer about one narrow question. It is not a bug report, and P is not the chance that a change is worth making.

**How to use this file.** Hand it to a person or a coding agent. For each item, read the listed lines, answer the question yourself, and change nothing if it does not hold. `no change` is a valid outcome. Verify before editing. Signals marked *experimental* have too little evidence to trust; see EVIDENCE.md.

## 1. summarize src/stats.ts:1–20 · internal_duplication@1.0.0 · P=1.00

- **Question:** Within the visible focus code, are there two or more near-identical blocks that differ only in literals or identifiers and could share one implementation?
- **Jev answer:** duplicated_blocks.
- **Read first:** src/stats.ts:1–20.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

## 2. lateFee src/billing.ts:1–7 · magic_policy_literal@1.0.0 · P=1.00

- **Question:** Does the visible focus code embed unexplained numeric or string literals that encode business policy, limits or thresholds (not trivial 0/1/empty values and not user-facing copy) without a named constant or comment?
- **Jev answer:** unexplained_policy_literal.
- **Read first:** src/billing.ts:1–7.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

## 3. tally src/tally.ts:1–8 · unused_local_or_parameter@1.0.0 · P=0.99

- **Question:** Does the visible focus code declare a local variable or parameter that is assigned or received but never read within the visible code?
- **Jev answer:** unused.
- **Read first:** src/tally.ts:1–8.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

## 4. clampPercent src/percent.ts:1–14 ↔ clampVolume src/volume.ts:1–14 · clone_same_policy@3.0.0 · P=0.98

- **Question:** Do the sections labeled pair.a and pair.b implement the same kind of policy or operation, after accounting for visible types, callees and callers? Mere normalized shape, similar names or interchangeable literals are not enough.
- **Jev answer:** same_policy.
- **Read first:** src/percent.ts:1–14; src/volume.ts:1–14.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

## 5. importOrders src/importer.ts:7–42 · function_should_split@1.0.0 · P=0.92

- **Question:** Is the section labeled focus long or dense enough that a reader must track many distinct steps, and do cohesive visible blocks exist that could each stand as a separately named function? Length alone is not enough; name the blocks in your reasoning.
- **Jev answer:** split_candidate.
- **Read first:** src/importer.ts:7–42; src/importer.ts:1–5.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

## 6. findTagged src/search.ts:5–21 · deep_nesting@1.0.0 · P=0.87

- **Question:** Does the visible focus code contain control flow nested three or more levels deep (if/loop/try/callback) that obscures its main path?
- **Jev answer:** deeply_nested.
- **Read first:** src/search.ts:5–21; src/search.ts:1–3.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.

## 7. importOrders src/importer.ts:7–42 · function_multiple_responsibilities@1.0.0 · P=0.87

- **Question:** Does the section labeled focus perform two or more separable responsibilities (for example fetching, transforming, persisting and presenting data) that are not coordinated by one stated purpose? Judge the visible body only.
- **Jev answer:** multiple.
- **Read first:** src/importer.ts:7–42; src/importer.ts:1–5.
- **Context Jev did not get:** none recorded; dynamic or external context may still be missing.
