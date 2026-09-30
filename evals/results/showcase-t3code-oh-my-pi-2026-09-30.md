# Showcase: t3code and oh-my-pi (2026-09-30)

We ran v0.1.1 on two public MIT-licensed TypeScript repositories to see what the scanner produces on code we did not write. **Everything in this section is a candidate for a person to check. Each item is a hypothesis, not a confirmed bug, and nothing here judges the quality of either codebase.** The labels come from an LLM reviewer, not from the maintainers, and no person has labeled anything. **One candidate (the first below) led to a bug reproduced with a regression test and an open, unmerged pull request, [can1357/oh-my-pi#13847](https://github.com/can1357/oh-my-pi/pull/13847); see the note under that item. We have opened no other issue or pull request and have not contacted the maintainers about the other candidates.**

**Pinned commits** (every line range below is at these commits):

- [`pingdotgg/t3code` @ `0fcd5f9`](https://github.com/pingdotgg/t3code/tree/0fcd5f90611451cca842689faea53b5450c022da)
- [`can1357/oh-my-pi` @ `2b023d1`](https://github.com/can1357/oh-my-pi/tree/2b023d1b80133c523d66412602d99b5427408395)

## What was scanned, and how little of each repository that is

The scanner read shallow clones at those commits, with git hooks off, nothing installed and nothing executed. Two passes were made, one request group per slice, with no retries:

- **First pass** (v0.1.0-alpha, whole repository). Its function index stopped at 3,000 functions, so functions in 318 (t3code) and 342 (oh-my-pi) files were never indexed. That bug is fixed in v0.1.1, and this pass is kept only as part of the combined sample.
- **Second pass** (v0.1.1, `--paths`), one slice per directory set:

| Repository | Directories scanned                                                             | Source files in scope | Read | Unread because of a limit |
| ---------- | ------------------------------------------------------------------------------- | --------------------- | ---- | ------------------------- |
| t3code     | `apps/web/src/components/chat`                                                  | 162                   | 144  | 0                         |
| t3code     | `apps/server/src/provider`                                                      | 225                   | 190  | 0                         |
| oh-my-pi   | `packages/coding-agent/src/extensibility`, `packages/coding-agent/src/commands` | 139                   | 118  | 0                         |

**Coverage.** Files that hold at least one judged unit (from both passes): **270 of 3,953 source files in t3code (6.8%)** and **156 of 5,637 in oh-my-pi (2.8%)**. Source files read at all, both passes: 819 (20.7%) and 590 (10.5%). Everything outside the directories above, and every file that had no judged unit, was not examined, so these results say nothing about the rest of either repository.

**Cost.** 4,060 requests to `jev-1.13.0`, 15,332,262 input and 966,029 output tokens: **US$0.64 calculated from the published tariff, not an invoice** (first pass US$0.23, second pass US$0.41). The reviewer's token use was not observable.

## How the sample was labeled

For each repository and signal we took a random sample (frozen seed, ordered by hash) of up to 6 cells at or above the 0.7 cut: 79 cells on 77 cards. An LLM reviewer (Claude Opus 5.5) labeled the cards alone first, and sealed those labels before it had any repository access (pass 1). It then read the repositories (pass 2). **Pass 2 is anchored on pass 1, and its changes lean one way: 6 of the 8 changes went to "actionable", because its searches looked for exactly the sibling copies pass 1 had marked as missing evidence.** Read pass 2 as a check directed by pass 1, not as an independent measurement.

This sample has no below-cut cells and only 6 per repository and signal, so it is **not the pre-registered gate** and cannot say a signal is default-worthy. The noise floor 1/sqrt(n) is 29% for 12 cells, 38% for 7 and 11% for all 79.

| Signal                               | Above-cut cells found (t3code / oh-my-pi) | Pass 1 actionable, t3code | Pass 1, oh-my-pi | Pass 1, both (noise floor) | Pass 2, both |
| ------------------------------------ | ----------------------------------------- | ------------------------- | ---------------- | -------------------------- | ------------ |
| `clone_same_policy`                  | 83 / 21                                   | 3/6                       | 2/6              | 5/12 (42%, ±29%)           | 7/12 (58%)   |
| `function_should_split`              | 107 / 58                                  | 1/6                       | 3/6              | 4/12 (33%, ±29%)           | 4/12 (33%)   |
| `magic_policy_literal`               | 80 / 26                                   | 0/6                       | 3/6              | 3/12 (25%, ±29%)           | 5/12 (42%)   |
| `internal_duplication`               | 142 / 88                                  | 2/6                       | 0/6              | 2/12 (17%, ±29%)           | 3/12 (25%)   |
| `function_multiple_responsibilities` | 9 / 1                                     | 5/6                       | 1/1              | 6/7 (86%, ±38%)            | 6/7 (86%)    |
| `unused_local_or_parameter`          | 10 / 11                                   | 0/6                       | 0/6              | 0/12 (0%, ±29%)            | 1/12 (8%)    |
| `deep_nesting`                       | 19 / 15                                   | 3/6                       | 5/6              | 8/12 (67%, ±29%)           | 8/12 (67%)   |
| all signals                          |                                           | 14/42                     | 14/37            | 28/79 (35%, ±11%)          | 34/79 (43%)  |

The two repositories differ: for example `internal_duplication` was actionable on 2 of 6 t3code cells and 0 of 6 oh-my-pi cells in pass 1. `function_multiple_responsibilities` had only 10 above-cut cells in the two repositories combined. Pass 1 labeled 5 cells "uncertain" (counted as not actionable above); pass 2 labeled none.

## Candidates the reviewer found strongest

Each is a hypothesis to verify. Ranges were re-read at the pinned commits.

1. **oh-my-pi, `packages/agent/src/agent-loop.ts`: two similar finalization sequences.** Lines [2163-2239](https://github.com/can1357/oh-my-pi/blob/2b023d1b80133c523d66412602d99b5427408395/packages/agent/src/agent-loop.ts#L2163-L2239) (the `done`/`error` branch inside the loop) and [2449-2513](https://github.com/can1357/oh-my-pi/blob/2b023d1b80133c523d66412602d99b5427408395/packages/agent/src/agent-loop.ts#L2449-L2513) (after the loop) repeat the same steps, ending in `finishChat`. They already differ: only the first wraps the result in `recoverTransientErrorToolTurn(retainCompletedToolCalls(...))` (2164-2167), and the first snapshots the message before `transformAssistantMessage` (2185-2191) while the second transforms it first (2468-2471). Worth checking whether both differences are intended. **Update:** the first difference was followed up. A pull request, [can1357/oh-my-pi#13847](https://github.com/can1357/oh-my-pi/pull/13847) (opened 2026-09-30, not merged, not confirmed by the maintainer), makes the trailing path use the same recovery and adds regression tests. Its description reports that a turn with a completed tool call followed by a transient stream error, settled through `end(result)`, is not recovered on the trailing path. This is the only candidate that has been reproduced; the labels elsewhere in this write-up are unchanged.
2. **t3code, `apps/server/src/provider/AntigravityInstallation.ts` and `CodexInstallation.ts`: copied install-management logic.** The remove guard ([875-917](https://github.com/pingdotgg/t3code/blob/0fcd5f90611451cca842689faea53b5450c022da/apps/server/src/provider/AntigravityInstallation.ts#L875-L917) vs [644-684](https://github.com/pingdotgg/t3code/blob/0fcd5f90611451cca842689faea53b5450c022da/apps/server/src/provider/CodexInstallation.ts#L644-L684)), the cancel handler (854-870 vs 627-639) and the atomic commit of the active-version pointer (538-561 vs 421-445) look alike. The remove copies differ: only the Antigravity one skips blank paths and checks `managedVersionDirectory`. [`apps/server/src/atomicWrite.ts`](https://github.com/pingdotgg/t3code/blob/0fcd5f90611451cca842689faea53b5450c022da/apps/server/src/atomicWrite.ts#L1-L25) (1-25) exists, and neither installation file references it.
3. **t3code, `apps/server/src/provider/CodexChatGptAuth.ts`: the same verification options twice.** `jwtVerify` is called with the same issuer, algorithms and clock tolerance at [609-624](https://github.com/pingdotgg/t3code/blob/0fcd5f90611451cca842689faea53b5450c022da/apps/server/src/provider/CodexChatGptAuth.ts#L609-L624) and [933-942](https://github.com/pingdotgg/t3code/blob/0fcd5f90611451cca842689faea53b5450c022da/apps/server/src/provider/CodexChatGptAuth.ts#L933-L942); only the audience source and the error message differ. A change to one set of options would need to be mirrored in the other.
4. **oh-my-pi, `annotate` command: the 999-character limit written in three places.** It appears as a check in [`text-review.ts:36`](https://github.com/can1357/oh-my-pi/blob/2b023d1b80133c523d66412602d99b5427408395/packages/coding-agent/src/extensibility/custom-commands/bundled/annotate/text-review.ts#L36), in user-facing messages in `index.ts` (lines 293 and 299), and as "fewer than 1,000 characters" in `prompts/text-summary.md` (line 1). A change to one could leave the others stale.
5. **oh-my-pi, `packages/coding-agent/src/extensibility/extensions/runner.ts`: an unnamed cap of 512 with the same eviction twice.** `markToolCallEmitted` ([583-589](https://github.com/can1357/oh-my-pi/blob/2b023d1b80133c523d66412602d99b5427408395/packages/coding-agent/src/extensibility/extensions/runner.ts#L583-L589)) and `markLoopToolCall` (597-603) each write the literal 512 and evict the oldest entry.

The reviewer listed more (for example three readers of `omp-plugins.lock.json` with different error handling, and repeated process-group termination in `opencodeRuntime.ts`); the full labeled sample and rationales are not included in this repository yet. Source files are quoted only by path and range, because both repositories are MIT-licensed and we link to them rather than copy them.

**What this section does not show.** It does not show that any candidate is a bug, that a change would be welcome, or that the scanner would do as well on other code. It shows what a small, random, LLM-labeled sample looked like on 2.8% to 6.8% of two repositories.
