import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { main } from "../src/cli.mjs";
import { POLICY } from "../src/core.mjs";
import {
  project,
  scratch,
  fake,
  response,
  positive,
  twoFiles,
} from "./helpers.mjs";

const cli = new URL("../src/cli.mjs", import.meta.url).pathname;
const expected = new URL("../examples/demo-app/expected/", import.meta.url)
  .pathname;

const quiet = (t) => {
  t.mock.method(console, "log", () => {});
  t.after(() => {
    process.exitCode = 0;
  });
};

const KINDS = [
  { name: "default", scan: [], conflict: "jev-1.13.0" },
  {
    name: "jev-latest",
    scan: ["--model", "jev-latest"],
    conflict: "jev-1.13.0",
  },
  {
    name: "jev-1.13.0",
    scan: ["--model", "jev-1.13.0"],
    conflict: POLICY.model,
  },
];

async function stoppedScan(t, kind) {
  const work = scratch(t),
    out = join(work, "scan");
  let sent = 0;
  await main(
    [
      "scan",
      project(t, twoFiles),
      "--run",
      "--yes",
      "--cap-usd",
      "1",
      "--out",
      out,
      ...kind.scan,
    ],
    {
      client: fake(async (r) => {
        sent++;
        return sent === 2
          ? { ...response(r), answers: {} }
          : response(r, positive(0.9));
      }),
    },
  );
  process.exitCode = 0;
  const planPath = join(out, "plan.json");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  return { work, planPath, plan, runDir: join(out, "run") };
}

const flags = (kind, model) => [
  ["absent", []],
  ["equal", ["--model", model]],
  ["conflicting", ["--model", kind.conflict]],
];

const escape = (s) => s.replaceAll(".", "\\.");
const refusal = (flag, model) =>
  new RegExp(
    `^Error: --model ${escape(flag)} does not match the saved plan, which requests ${escape(model)}\\. .*jevs scan PATH --model ${escape(flag)}`,
  );

for (const kind of KINDS)
  test(`run on a ${kind.name} plan sends the plan's model and refuses a conflicting --model before any request`, async (t) => {
    quiet(t);
    const { work, planPath, plan } = await stoppedScan(t, kind);
    const model = plan.policy.model;
    const before = readFileSync(planPath);
    for (const [label, extra] of flags(kind, model)) {
      const out = join(work, `run-${label}`);
      const sent = [];
      const args = [
        "run",
        "--plan",
        planPath,
        "--yes",
        "--cap-usd",
        "1",
        "--out",
        out,
        ...extra,
      ];
      const client = fake(async (r) => {
        sent.push(r.model);
        return response(r, positive(0.9));
      });
      if (label === "conflicting") {
        await assert.rejects(
          main(args, { client }),
          refusal(kind.conflict, model),
        );
        assert.deepEqual([sent, existsSync(out)], [[], false]);
      } else {
        await main(args, { client });
        assert.deepEqual([...new Set(sent)], [model], label);
        assert.equal(
          JSON.parse(readFileSync(join(out, "report.json"))).requestedModel,
          model,
        );
      }
    }
    assert.deepEqual(readFileSync(planPath), before);
  });

for (const kind of KINDS)
  test(`continue on a ${kind.name} plan keeps the plan's model and refuses a conflicting --model before writing`, async (t) => {
    quiet(t);
    const { work, planPath, plan, runDir } = await stoppedScan(t, kind);
    const model = plan.policy.model;
    const before = readFileSync(planPath);
    for (const [label, extra] of flags(kind, model)) {
      const out = join(work, `continue-${label}.json`);
      const args = [
        "continue",
        "--plan",
        planPath,
        "--run-dir",
        runDir,
        "--out",
        out,
        ...extra,
      ];
      if (label === "conflicting") {
        await assert.rejects(main(args), refusal(kind.conflict, model));
        assert.equal(existsSync(out), false);
      } else {
        await main(args);
        const next = JSON.parse(readFileSync(out, "utf8"));
        assert.deepEqual(
          [
            next.policy.model,
            [...new Set(next.requests.map((r) => r.request.model))],
          ],
          [model, [model]],
        );
      }
    }
    assert.deepEqual(readFileSync(planPath), before);
  });

for (const kind of KINDS)
  test(`report on a ${kind.name} plan keeps the plan's model and refuses a conflicting --model before writing`, async (t) => {
    quiet(t);
    const { work, planPath, plan, runDir } = await stoppedScan(t, kind);
    const model = plan.policy.model;
    const before = readFileSync(planPath);
    const journal = readFileSync(join(runDir, "journal.jsonl"));
    for (const [label, extra] of flags(kind, model)) {
      const out = join(work, `report-${label}`);
      const args = [
        "report",
        "--plan",
        planPath,
        "--run-dir",
        runDir,
        "--out",
        out,
        ...extra,
      ];
      if (label === "conflicting") {
        await assert.rejects(main(args), refusal(kind.conflict, model));
        assert.equal(existsSync(out), false);
      } else {
        await main(args);
        assert.equal(
          JSON.parse(readFileSync(join(out, "report.json"))).requestedModel,
          model,
        );
      }
    }
    assert.deepEqual(
      [readFileSync(planPath), readFileSync(join(runDir, "journal.jsonl"))],
      [before, journal],
    );
  });

const spawnCli = (cwd, args) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: cwd },
    encoding: "utf8",
  });

test("the CLI refuses a conflicting --model on run before it looks for a key", (t) => {
  const cwd = scratch(t);
  const result = spawnCli(cwd, [
    "run",
    "--plan",
    join(expected, "plan.json"),
    "--yes",
    "--cap-usd",
    "1",
    "--out",
    join(cwd, "out"),
    "--model",
    "jev-latest",
  ]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /^Error: --model jev-latest does not match the saved plan, which requests jev-1\.13\.0\. /,
  );
  assert.doesNotMatch(result.stderr, /API key/);
  assert.deepEqual(readdirSync(cwd), []);
});

test("the jev-1.13.0 recording reports with its own model named and refuses another in report and rescore", (t) => {
  const cwd = scratch(t);
  const plan = ["--plan", join(expected, "plan.json")];
  const ok = spawnCli(cwd, [
    "report",
    ...plan,
    "--run-dir",
    expected,
    "--out",
    join(cwd, "a"),
    "--model",
    "jev-1.13.0",
  ]);
  assert.equal(ok.status, 0, ok.stderr);
  const refused = [
    ["report", ...plan, "--run-dir", expected, "--out", join(cwd, "b")],
    ["rescore", expected, ...plan, "--cut", "0.5", "--out", join(cwd, "c")],
  ].map((args) => spawnCli(cwd, [...args, "--model", POLICY.model]));
  for (const r of refused) {
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /does not match the saved plan, which requests jev-1\.13\.0/,
    );
  }
  assert.deepEqual(readdirSync(cwd), ["a"]);
});
