## What and why

## Checks

- [ ] `npm run ci` passes (tests are offline and never call Jev)
- [ ] `python3 -m unittest discover -s test -p test_pinned_config.py` passes
- [ ] No new network call, no file read outside the analyzed project, no target code execution
- [ ] Jev stays the only judge: code forms units and gathers context; it does not score, rank or filter
- [ ] A new or changed question bumps its `version` and clears its `evidence`
- [ ] Any number in docs says how many cells, who labeled them, and on what project
- [ ] No secrets, no `plan.json`, no source copied from a repository whose license does not allow it
