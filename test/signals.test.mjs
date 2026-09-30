import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPlan } from "../src/build-plan.mjs";
import { fullCatalog } from "../src/catalog.mjs";
import { checkSignal } from "../scripts/check-signal.mjs";
import { fake, response, positive } from "./helpers.mjs";

const fixtures = new URL("./fixtures/", import.meta.url).pathname;

test("every signal has positive and negative fixtures that produce a request asking that question", () => {
  for (const signal of fullCatalog.signals)
    for (const variant of ["positive", "negative"]) {
      const root = join(fixtures, signal.id, variant);
      assert.ok(existsSync(root), `${signal.id}/${variant} fixture missing`);
      const plan = buildPlan(root, { signals: [signal.id] });
      const asked = plan.requests.filter(
        (r) => signal.id in r.request.questions,
      );
      assert.ok(asked.length > 0, `${signal.id}/${variant} yields no request`);
      for (const r of asked)
        assert.equal(r.request.questions[signal.id].criteria, signal.criteria);
      const kinds = new Set(asked.map((r) => r.request.state.kind));
      assert.ok([...kinds].every((k) => signal.kinds.includes(k)));
    }
});

test("fixtures stay small", () => {
  for (const signal of fullCatalog.signals)
    for (const variant of ["positive", "negative"]) {
      const plan = buildPlan(join(fixtures, signal.id, variant), {
        signals: [signal.id],
      });
      const bytes = plan.units.reduce(
        (n, u) => n + u.sections.reduce((m, s) => m + s.source.length, 0),
        0,
      );
      assert.ok(bytes < 4000, `${signal.id}/${variant} is ${bytes} bytes`);
    }
});

test("check-signal reports whether positive and negative fixtures separate at the cut", async () => {
  const id = "deep_nesting";
  const positiveSource = readFileSync(
    join(fixtures, id, "positive", "nest.ts"),
    "utf8",
  );
  const answer = async (request) =>
    response(request, (_id, signal, negative) =>
      request.state.sections.some((s) =>
        s.source.includes("for (const candidate"),
      )
        ? positive(0.9)(_id, signal, negative)
        : positive(0.1)(_id, signal, negative),
    );
  assert.ok(positiveSource.includes("for (const candidate"));
  const good = await checkSignal(id, { client: fake(answer) });
  assert.equal(good.ok, true);
  assert.deepEqual(Object.keys(good.variants), ["positive", "negative"]);
  const flat = await checkSignal(id, {
    client: fake(async (r) => response(r, positive(0.9))),
  });
  assert.equal(
    flat.ok,
    false,
    "a question that fires on the negative fixture fails",
  );
  await assert.rejects(
    checkSignal("nope", { client: fake() }),
    /Unknown signal/,
  );
});
