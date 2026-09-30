# Security and privacy

## What this tool sends

A live run sends source excerpts of your project to the Jev API at `https://api.typesafe.ai`, using your `TYPESAFE_API_KEY`. That is the whole purpose of the tool. A dry run (the default) sends nothing and needs no key.

- What is analyzed is what is sent: each function or pair, plus bounded context (callers, imported declarations, one hop). `--list-files` shows every file whose source would be sent.
- The tool never reads `node_modules`, dot-directories, build output, generated files or symlinks, and anything you pass to `--exclude`.
- It skips files whose path contains `secret` or `credential`, and files whose content looks like a private key, a token or a password assignment. **This is a heuristic.** It will miss secrets that do not look like the patterns it knows. Review `--list-files` and use `--exclude` for anything sensitive. Do not run it on code you are not allowed to share with a third-party API.
- The API key is read from the environment only. It is never accepted as an option, printed or written. Error bodies from the API are not stored, because they can echo credentials.

## What it writes

Only into the output directory you choose, which must be outside the analyzed project: `plan.json` (contains source excerpts, keep it private), the run journal (answers and token counts, no source), and the reports (paths, line ranges, hashes and Jev's answers, no source). Nothing runs your project's code, scripts, tests or config.

## Reporting a problem

Please open a private security advisory on the repository, or email the maintainers listed there. Include a minimal input that shows the problem. Do not include real secrets.
