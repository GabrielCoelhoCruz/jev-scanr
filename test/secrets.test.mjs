import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/build-plan.mjs";
import { project } from "./helpers.mjs";

const body =
  "export function compute(input: number) {\n  return input + 1;\n}\n";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const join = (...parts) => parts.join("");

const secrets = {
  "assigned.ts": `const apiKey = "${"a1B2c3D4e5F6g7H8"}";\n${body}`,
  "json-key.ts": `export const config = {\n  "apiKey": "${"a1B2c3D4e5F6g7H8"}",\n};\n${body}`,
  "json-password.ts": `const c = { "db_password": '${"hunter2hunter2hunter2"}' };\n${body}`,
  "openai.ts": `const k = "${join("sk-", "proj-", "A1b2C3d4E5f6G7h8I9j0K1l2")}";\n${body}`,
  "stripe-live.ts": `const k = "${join("sk_", "live_", "A1b2C3d4E5f6G7h8I9j0K1l2")}";\n${body}`,
  "stripe-restricted.ts": `const k = "${join("rk_", "live_", "A1b2C3d4E5f6G7h8I9j0K1l2")}";\n${body}`,
  "slack-bot.ts": `const k = "${join("xox", "b-", "1234567890-0987654321-AbCdEfGhIjKl")}";\n${body}`,
  "slack-user.ts": `const k = "${join("xox", "p-", "1234567890-0987654321-AbCdEfGhIjKl")}";\n${body}`,
  "jwt.ts": `const t = "${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "1234567890", name: "Ada" })}.${"s3cr3tS1gnature"}";\n${body}`,
  "postgres-url.ts": `const url = "${join("postgres", "://", "admin", ":", "s3nhaforte", "@", "db.internal:5432/app")}";\n${body}`,
  "pem.ts": `const k = \`${join("-----BEGIN ", "PRIVATE KEY", "-----")}\`;\n${body}`,
};

const clean = {
  "tokenizer.ts": `export const tokenizer = createTokenizer();\nexport function tokenize(text: string) {\n  return text.split(" ");\n}\n`,
  "types.ts": `export interface Credentials {\n  password: string;\n  apiKey?: string;\n}\n${body}`,
  "env.ts": `const apiKey = process.env.API_KEY;\nconst password = "";\n${body}`,
  "short.ts": `const token = "abc";\nconst secret = 'short';\n${body}`,
  "template-url.ts": `export const dsn = \`\${scheme}://\${user}:\${pass}@\${host}/db\`;\n${body}`,
  "plain-urls.ts": `const a = "https://example.com:8080/docs";\nconst b = "git@github.com:owner/repo.git";\nconst c = "http://localhost:3000/a@b";\nconst d = "http://user:pass@example.com/docs";\n${body}`,
  "partial-tokens.ts": `const a = "sk-short";\nconst b = "eyJhbGciOi";\nconst c = "xoxb-";\nconst d = "sk_live_";\n${body}`,
};

test("the dry-run file list skips files that hold a key, token, JWT or credentialed URL, in any common spelling", (t) => {
  const plan = buildPlan(project(t, { ...secrets, ...clean }));
  const status = (path) => plan.files.find((f) => f.path === path)?.status;
  assert.deepEqual(
    Object.fromEntries(Object.keys(secrets).map((p) => [p, status(p)])),
    Object.fromEntries(
      Object.keys(secrets).map((p) => [
        p,
        "potential_secret_no_content_stored",
      ]),
    ),
  );
  assert.deepEqual(
    Object.fromEntries(Object.keys(clean).map((p) => [p, status(p)])),
    Object.fromEntries(Object.keys(clean).map((p) => [p, "read"])),
  );
});
