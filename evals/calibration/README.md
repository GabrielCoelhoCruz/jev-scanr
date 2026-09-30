# Calibrating the judge

A signal can only go on by default when someone judged whether its findings were worth acting on. If that someone is an LLM, we first check it against a person.

**The first calibration set is `human-30`**: 30 cards labeled by the project author, without seeing any model's labels (see `calibration-sets.json`). Until those labels exist, no LLM judge is calibrated, and the gate accepts only human labels.

To calibrate a judge on a set:

```sh
# 1. Turn the cards into judge tasks (rubric, untrusted-code warning, three known-negative controls)
node evals/cli.mjs judge-tasks --cards cards-human.json --out judge-tasks.json

# 2. Run each task's `prompt` with your judge model, one JSON line per task. The judge must not be Jev.
#    Save the lines as judge-answers.jsonl.

# 3. Validate the answers. This fails if the judge missed a control, or if it is a Jev model.
node evals/cli.mjs judge-import --tasks judge-tasks.json --labels judge-answers.jsonl \
  --model <judge model id> --out judge-labels.json

# 4. Compare with the human labels (human-labels/1, filled in from labels-template.json)
node evals/cli.mjs calibrate --judge judge-labels.json --human human-labels.json --human-blind \
  --judge-model <judge model id> --out judge-calibration.json
```

`calibrate` reports agreement on the **clear** cases (where the human said `actionable` or `no_action`), Cohen's kappa, the confusion matrix and a 95% interval. The judge is calibrated when there are at least 20 clear cases and agreement is at least 90%. It is calibrated for that model and that rubric only: change either and repeat the check. With 30 cards the interval is wide, so a result at 90% is a reason to proceed carefully, not proof.

An existing reviewer's labels in the blind-review format (`blind-relational-reference/1`) can be passed directly as `--judge`, if the reviewer labeled the same cards without seeing the human labels.
