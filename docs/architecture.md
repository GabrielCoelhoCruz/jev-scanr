# Architecture

`jev-scanr` is a small pipeline with one rule: **Jev is the only judge.** Code forms units, gathers context and decides which units are asked (retrieval, with cheap deterministic pre-filters listed in [`RETRIEVAL.md`](RETRIEVAL.md)); it never scores, ranks or filters Jev's answers. A finding's presence, its order and the display cut all come from Jev's probabilities.

The project was called `semantic-refactor-scan`, then `jev-refactor`, and is now `jev-scanr`. Two names are older than the project name: the schema identifiers `semantic-refactor-scan-plan/1` and `semantic-refactor-scan-report/1` are kept as they are, because plans, receipts and the recorded demo in `examples/demo-app/expected/` are bound to them by hash. They name data formats, not the tool.

```
project ──▶ snapshot ──▶ index ──▶ units ──▶ context ──▶ requests ──▶ Jev ──▶ journal ──▶ report
```

1. **Snapshot** (`src/snapshot.mjs`). Reads source files under caps (files, bytes, entries). Skips excluded paths, dot-directories, dependencies, build output, generated files, symlinks and anything that looks like a secret. Records each file's SHA-256.
2. **Index** (`src/index.mjs`). Parses with Babel, finds functions, imports, calls and static references. Config files (`tsconfig.json`) are read as data, never executed.
3. **Units** (`src/units.mjs`, `src/candidates.mjs`). One unit per outermost non-test function, and one per _similar pair_, from two sources: token-shingle overlap, and a capped low-overlap source for mechanical rewrites (shared outside names, literals and shape). `name_vs_behavior`, when enabled, asks only functions whose name words are absent from the body. Pair and function selection is retrieval only; its ordering decides which pairs survive a cap and nothing the report shows. Details and biases: [`RETRIEVAL.md`](RETRIEVAL.md). Only unit kinds that an enabled signal asks about are formed.
4. **Context** (`src/packs.mjs`, `src/operand-context.mjs`). For each unit: the focus code, bounded callers, imported declarations (one hop) and test references. References are trimmed in a fixed order until the request fits a **24,000-byte trim target**, which is a quality choice: smaller states are answered more accurately. The focus source is never trimmed. A focus that is still larger than the target is sent whole, in one request, as long as it fits the **provider budget**: a 64,000-byte hard cap, which is 32k tokens at 2 bytes per token (the worst ratio measured is 2.35), against Jev's 32k-token limit for the state plus the longest question and 64k for the request. Only above that is it split into question groups, then into line windows, and whole-function questions abstain visibly instead of guessing.
5. **Requests** (`src/plan.mjs`, `src/build-plan.mjs`). One request per unit (or split part), carrying _every_ eligible question for that unit. Jev scores the questions about one state independently, so batching them costs no accuracy and pays for the state once. Different units are never packed into one state, because extra unrelated code in the state lowers accuracy. The plan hashes every unit and request, and `verifyPlan` re-derives them, so an edited plan is rejected.
6. **Run** (`src/runner.mjs`). Bounded concurrency (default 8, at most 32) behind a token-bucket limiter at 80% of Jev's documented 40 requests and 100K tokens per second, no retries. A reservation is written to an append-only, hash-chained journal _before_ each call. A crash after a reservation blocks a blind retry. The run stops on the first error, a 429, an unexpected model, unknown usage or an invalid answer, and before any request that could pass the cost cap.
7. **Validation** (`src/validation.mjs`). Each answer must have the requested questions, valid options, probabilities in range summing to about 1, and a chosen option within 0.01 of the maximum (Jev rounds to two decimals). Only known fields are stored.
8. **Credentials** (`src/credentials.mjs`). The API key is read in one place: `TYPESAFE_API_KEY` from the environment, else the owner-only file `jevs auth` wrote (`$XDG_CONFIG_HOME/jev-scanr/credentials.json`, mode 0600, refused if other users can read it). It is never a command-line option and never reaches a report, a journal or an error message.
9. **Report** (`src/report.mjs`). P(positive option) per cell. A cell is a finding if its own P is at or above the display cut. Findings are ordered by P. Unanswered cells are abstentions, not scores.

## Continuations

`continue` builds a plan of only the requests that have no accepted answer, byte-identical to the base plan's requests and bound to the base plan's hash and journal head. `report --continuation-plan … --continuation-run …` recomputes that plan from the base run, rejects any difference, and accounts for both runs without double counting.

## What is deliberately not here

No bug, security or performance detection. No auto-fix. No deterministic scoring, ranking or fallback. No reading of `node_modules`. Catch-block, comment-block and sibling-function units, and fourteen questions, were tried and removed; see `signals/retired.md`.

## Evals

`evals/` reuses the same planner, runner and validator to test a question, so an eval exercises the real code path. It adds a case-set audit, grader self-checks (oracle, null, no answer, induced error, served model), P-variance measurement, an LLM-judge protocol with calibration, and the pre-registered gate. See [`evals/README.md`](../evals/README.md).
