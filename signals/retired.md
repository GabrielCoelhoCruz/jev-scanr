# Retired signals

These 14 questions were part of the 22-signal catalog in the scanner prototype. They are **not** in this release's catalog and cannot be switched on. They are listed here with the numbers that removed them, so the decision can be checked and revisited.

All numbers come from one run on one project (the daily-tracker app, a TypeScript / React Native codebase), scored by `jev-1.13.0`, then reviewed by one LLM reviewer (Claude Opus 5.5) in two passes. The reviewed cells were the top 5 by probability at or above the 0.7 cut, plus 3 random cells below it. This is not human truth, and for signals with many cells above the cut, the top 5 are the most favorable ones. See `EVIDENCE.md`.

A signal is retired when none of its sampled top cells was actionable (`A top = 0`), or when it never reached the cut at all. Bringing one back means a new question version that passes the gate in `CONTRIBUTING.md`; a retired question's evidence does not carry over to a rewrite.

| Signal                          | Cells at or above 0.7 (full run) | Reviewed above the cut | Actionable above the cut | Reviewed below the cut | Actionable below the cut |
| ------------------------------- | -------------------------------: | ---------------------: | -----------------------: | ---------------------: | -----------------------: |
| `clone_behavior_difference`     |                              183 |                      5 |                        0 |                      3 |                        0 |
| `clone_variation_context`       |                                0 |                      0 |                        0 |                      3 |                        0 |
| `sibling_failure_contract`      |                                3 |                      3 |                        0 |                      1 |                        0 |
| `sibling_caller_context`        |                                0 |                      0 |                        0 |                      3 |                        0 |
| `recovery_caller_observability` |                                4 |                      4 |                        0 |                      3 |                        0 |
| `recovery_feedback`             |                                4 |                      4 |                        0 |                      3 |                        0 |
| `recovery_declared_fallback`    |                                7 |                      5 |                        0 |                      3 |                        0 |
| `function_flag_parameter`       |                               26 |                      5 |                        0 |                      3 |                        0 |
| `function_misleading_name`      |                                0 |                      0 |                        0 |                      3 |                        0 |
| `function_inconsistent_returns` |                                0 |                      0 |                        0 |                      3 |                        0 |
| `comment_narrates_code`         |                                5 |                      5 |                        0 |                      3 |                        0 |
| `comment_contradicts_code`      |                                3 |                      3 |                        0 |                      3 |                        0 |
| `floating_promise`              |                                1 |                      1 |                        0 |                      3 |                        0 |
| `unsafe_type_escape`            |                               19 |                      5 |                        0 |                      3 |                        0 |

Unit kinds for catch blocks, comment blocks and sibling functions were dropped with these signals.

## `clone_behavior_difference`

- **Question (v3.0.0):** Is a concrete difference in possible output, side effect, branch condition or failure behavior visible between pair.a and pair.b? Identify presence only; do not infer that an update was missed or that the difference is unintended.
- **Unit kinds:** clone_pair
- **Why it was retired:** Flagged 183 of 195 clone pairs at or above the cut. The reviewer found the differences were style variants or identical bodies, so nothing was worth acting on.

## `clone_variation_context`

- **Question (v3.0.0):** Do visible types, callers, declarations or configuration explicitly support different treatment by pair.a and pair.b? Judge evidence of differentiated use, not guessed intent or historical drift.
- **Unit kinds:** clone_pair
- **Why it was retired:** No cell reached the 0.7 cut, so it cannot produce a finding at the default cut.

## `sibling_failure_contract`

- **Question (v3.0.0):** Do the supplied sibling functions expose failure to their callers through the same observable mechanism? Examine the failure paths and return declarations, not their names or shared callee spelling alone.
- **Unit kinds:** sibling
- **Why it was retired:** Sibling functions are not a unit in this release. The three sampled cells were all judged fine as written (each endpoint has one client that handles its own envelope).

## `sibling_caller_context`

- **Question (v3.0.0):** Do supplied callers or explicit contracts visibly rely on differing failure mechanisms of the sibling functions? Do not infer a requirement merely from a different function name.
- **Unit kinds:** sibling
- **Why it was retired:** Sibling units are not in this release; no cell reached the cut.

## `recovery_caller_observability`

- **Question (v3.0.0):** Can any supplied caller distinguish the focused recovered failure from ordinary success using the shown return value or state? This concerns only supplied callers, not all possible external callers.
- **Unit kinds:** catch
- **Why it was retired:** Catch blocks are not a unit in this release. Nearly every sampled catch was an HTTP handler returning an explicit error, a commented retry, or a cancelled share sheet.

## `recovery_feedback`

- **Question (v3.0.0):** Does the focused recovery path visibly emit failure feedback through a user-facing mechanism or logging operation? Unknown helper names alone do not prove feedback.
- **Unit kinds:** catch
- **Why it was retired:** Same as above: sampled catches already report failure through a response, a log or a documented cancel.

## `recovery_declared_fallback`

- **Question (v3.0.0):** Does an explicit supplied comment, type contract or caller contract state that this failure is intentionally ignored or replaced by fallback? A suggestive function name is not an explicit declaration.
- **Unit kinds:** catch
- **Why it was retired:** Same as above; the fallbacks were intentional and visible.

## `function_flag_parameter`

- **Question (v1.0.0):** Does the section labeled focus take a boolean or mode parameter that selects between substantially different code paths inside the body?
- **Unit kinds:** function
- **Why it was retired:** The sampled cells were component props, typed discriminants or predicates, not flags that select divergent code paths.

## `function_misleading_name`

- **Question (v1.0.0):** Does the name of the section labeled focus describe something materially different from what its visible body does (for example a get\* that mutates state, or a name for one domain applied to another)?
- **Unit kinds:** function
- **Why it was retired:** No cell reached the 0.7 cut.

## `function_inconsistent_returns`

- **Question (v1.0.0):** Do different return paths of the section labeled focus produce values of incompatible shape or meaning (for example sometimes undefined, sometimes an object) without a visible type or comment accounting for it?
- **Unit kinds:** function
- **Why it was retired:** No cell reached the 0.7 cut.

## `comment_narrates_code`

- **Question (v1.0.0):** Do comments in the visible code merely restate what the adjacent statement does, adding no intent, constraint, rationale or warning?
- **Unit kinds:** function, function_chunk, comment_block
- **Why it was retired:** Comment blocks are not a unit in this release. The five cells above the cut were all judged not worth acting on.

## `comment_contradicts_code`

- **Question (v1.0.0):** Does any comment in the visible code describe behavior that the adjacent visible code does not do (stale or copied comment)?
- **Unit kinds:** function, function_chunk, comment_block
- **Why it was retired:** The three cells above the cut were checked against the code and the comments held.

## `floating_promise`

- **Question (v1.0.0):** Is a promise-returning call in the visible focus code neither awaited, returned, nor given a rejection handler, so that its failure would go unobserved?
- **Unit kinds:** function, function_chunk
- **Why it was retired:** One cell above the cut, judged not worth acting on. Too little data to say more.

## `unsafe_type_escape`

- **Question (v1.0.0):** Does the visible focus code use any, a non-null assertion or a type assertion to bypass a type that the code does not otherwise check, where a visible value could violate it?
- **Unit kinds:** function, function_chunk
- **Why it was retired:** 19 cells above the cut. The sampled ones were a single identity-migration cast repeated, or contained no type escape at all.
