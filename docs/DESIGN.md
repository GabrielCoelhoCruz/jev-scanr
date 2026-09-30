# How it works

```
project ──▶ snapshot ──▶ index ──▶ units ──▶ context ──▶ requests ──▶ Jev ──▶ journal ──▶ report
```

1. **Snapshot** (`src/snapshot.mjs`). Reads source files under caps (files, bytes, entries). Skips excluded paths, dot-directories, dependencies, build output, generated files, symlinks and anything that looks like a secret. Records each file's SHA-256.
2. **Index** (`src/index.mjs`). Parses with Babel, finds functions, imports, calls and static references. Config files (`tsconfig.json`) are read as data, never executed.
3. **Units** (`src/units.mjs`, `src/candidates.mjs`). One unit per outermost non-test function, and one per _similar pair_ (token-shingle overlap). Pair formation is retrieval only; it never scores. Only unit kinds that an enabled signal asks about are formed.
4. **Context** (`src/packs.mjs`, `src/operand-context.mjs`). For each unit: the focus code, bounded callers, imported declarations (one hop) and test references. If the request would exceed the byte cap, references are trimmed by a fixed order. The focus source is never trimmed. A function that still does not fit is split into question groups, then into line windows; whole-function questions abstain visibly instead of guessing.
5. **Requests** (`src/plan.mjs`, `src/build-plan.mjs`). One request per unit (or split part), with the enabled questions that apply. The plan hashes every unit and request, and `verifyPlan` re-derives them, so an edited plan is rejected.
6. **Run** (`src/runner.mjs`). Sequential, no retries. A reservation is written to an append-only, hash-chained journal _before_ each call. A crash after a reservation blocks a blind retry. The run stops on the first error, a 429, an unexpected model, unknown usage or an invalid answer, and before any request that could pass the cost cap.
7. **Validation** (`src/validation.mjs`). Each answer must have the requested questions, valid options, probabilities in range summing to about 1, and a chosen option within 0.01 of the maximum (Jev rounds to two decimals). Only known fields are stored.
8. **Report** (`src/report.mjs`). P(positive option) per cell. A cell is a finding if its own P is at or above the display cut. Findings are ordered by P. Unanswered cells are abstentions, not scores.

## Continuations

`continue` builds a plan of only the requests that have no accepted answer, byte-identical to the base plan's requests and bound to the base plan's hash and journal head. `report --continuation-plan … --continuation-run …` recomputes that plan from the base run, rejects any difference, and accounts for both runs without double counting.

## What is deliberately not here

No bug, security or performance detection. No auto-fix. No deterministic scoring, ranking or fallback. No reading of `node_modules`. Catch-block, comment-block and sibling-function units, and fourteen questions, were tried and removed; see `signals/retired.md`.

## Evals

`evals/` reuses the same planner, runner and validator to test a question, so an eval exercises the real code path. It adds a case-set audit, grader self-checks (oracle, null, no answer, induced error, served model), P-variance measurement, an LLM-judge protocol with calibration, and the pre-registered gate. See [`evals/README.md`](../evals/README.md).
