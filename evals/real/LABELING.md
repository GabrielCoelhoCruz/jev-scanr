# Labeler instructions

The same text goes to every labeler, unchanged. A labeler sees `items.jsonl` (id, name, code) and nothing else: no Jev output, no feature, no other labeler's file.

> You are labeling 400 JavaScript or TypeScript functions, one question each. The question: **does the name of the function describe what its body does?** Judge only from the code in the item. Do not run code, do not search the web, do not look for the repository, and do not open any file except your `items.jsonl` and your output file.
>
> Give one label per item:
>
> - `mismatch`: a developer who read only the name would expect a different operation or domain than the body performs. The name is wrong or misleading, not merely vague. Example: `validateEmail` whose body formats a date; `getUser` whose body deletes a record.
> - `imprecise`: the name fits the main behavior but is generic, too narrow, leaves out a significant side effect, or is loosely worded. A reader would be mildly off, not surprised.
> - `fits`: the name is consistent with what the body does.
> - `cannot_tell`: the body depends so much on code you cannot see that the name cannot be judged either way.
>
> When in doubt between `mismatch` and `imprecise`, choose `imprecise`. When in doubt between `imprecise` and `fits`, choose `fits`. Use `cannot_tell` only when the excerpt really lacks what you need, not because the function is long.
>
> Work in chunks of 40 items. After each chunk, append one JSON line per item to `labels.jsonl` in the form `{"id":"...","label":"mismatch|imprecise|fits|cannot_tell","note":"at most 15 words naming what the body does"}`. At the end, check that `labels.jsonl` has exactly 400 lines and 400 distinct ids, each from `items.jsonl`. Do not skip items and do not reorder the ids.
