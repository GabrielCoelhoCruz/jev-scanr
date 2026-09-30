# Case study: one candidate on the author's own app

Part of the [signal curation](signal-curation-daily-tracker.md) run. **This is one item, chosen because it shows what a useful candidate looks like and what it takes to confirm one. It is not a measure of accuracy, and nothing here was sent to the app's maintainer as a bug report: the app is the author's own.**

The prototype run behind these numbers was on the author's own app, [`GabrielCoelhoCruz/daily-tracker`](https://github.com/GabrielCoelhoCruz/daily-tracker) at commit `6b8e9d08767e0364f78ccdf763ea654429cf5fc8` (a React Native / Expo app). A sanitized copy was scanned, with two files withheld. The run put 473 cells at or above the cut. One of them shows what a useful item looks like, and what it takes to confirm one.

`buildMetrics` in `components/history/HistoryMetricsGrid.tsx` (lines 23–79) came out at P=0.99 for `magic_policy_literal`. It colours a weekly score with two bare thresholds:

```ts
const averageColor =
  review.averageScore != null && review.averageScore >= 75
    ? theme.colors.semantic.success
    : review.averageScore != null && review.averageScore >= 50
      ? theme.colors.accent.DEFAULT
```

The reviewer's first pass, from the request context alone, said `uncertain`: it could not tell whether a shared constant or helper already existed. With repository access it changed to `actionable`. On the same History screen, `WeeklyReviewCard` colours the same score at 90 / 75 / 50, and a helper, `getExecutionScoreTone`, already encodes 90 / 75 / 50. So the 75 / 50 bands are a real inconsistency, and the refactor is to use the helper. The item alone only said "unexplained literals". Confirming it took reading the repository, which is what the queue asks you or your agent to do. Nobody has confirmed this as a bug, and the app was not changed by this project.

The only code shown is the five lines above, from a public repository; the two files withheld from the scan are not reproduced or described here.
