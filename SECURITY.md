# Security and privacy

## What this tool sends

A live run sends source excerpts of your project to the Jev API at `https://api.typesafe.ai`, using your own key (`TYPESAFE_API_KEY`, or the one saved by `jr auth`). That is the whole purpose of the tool. A dry run (the default) sends nothing and needs no key.

- What is analyzed is what is sent: each function or pair, plus bounded context (callers, imported declarations, one hop). `--list-files` shows every file whose source would be sent.
- The tool never reads `node_modules`, dot-directories, build output, generated files or symlinks, and anything you pass to `--exclude`.
- It skips files whose path contains `secret` or `credential`, and files whose content looks like a private key, a token or a password assignment. **This is a heuristic.** It will miss secrets that do not look like the patterns it knows. Review `--list-files` and use `--exclude` for anything sensitive. Do not run it on code you are not allowed to share with a third-party API.
- The API key is read in one place (`src/credentials.mjs`): `TYPESAFE_API_KEY` from the environment, else the file saved by `jr auth` (`$XDG_CONFIG_HOME/jev-refactor/credentials.json`, default `~/.config/jev-refactor/`, mode 0600 in a 0700 directory; a file readable by other users is refused). It is never accepted as an option, printed, or written into a report, journal or error. `jr auth --remove` deletes it. Error bodies from the API are not stored, because they can echo credentials.

## What it writes

Only into the output directory you choose, which must be outside the analyzed project: `plan.json` (contains source excerpts, keep it private), the run journal (answers and token counts, no source), and the reports (paths, line ranges, hashes and Jev's answers, no source). Nothing runs your project's code, scripts, tests or config.

## Reporting a problem

Please use GitHub's private vulnerability reporting on this repository (Security tab, then Report a vulnerability). Do not open a public issue for a security problem. Include a minimal input that shows the problem. Do not include real secrets.
