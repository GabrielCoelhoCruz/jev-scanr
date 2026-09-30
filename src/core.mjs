import { createHash } from "node:crypto";
import {
  readFileSync,
  realpathSync,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { resolve, dirname, sep } from "node:path";

export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
export const POLICY = Object.freeze({
  model: "jev-1.13.0",
  maxInputTokens: 65536,
  inputUSDPerMillion: 0.042,
  outputUSDPerMillion: 0,
  timeoutMs: 10000,
  minIntervalMs: 300,
  concurrency: 1,
  retries: 0,
});
export const secretLike = (source) =>
  /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|(?:api[_-]?key|password|secret|token)\s*[:=]\s*['"`][^'"`\s]{12,}['"`]|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/i.test(
    source,
  );

export function physical(path) {
  const full = resolve(path);
  if (existsSync(full)) return realpathSync(full);
  return resolve(physical(dirname(full)), full.slice(dirname(full).length + 1));
}

export function outside(root, output) {
  const r = physical(root),
    o = physical(output);
  if (o === r || o.startsWith(r + sep))
    throw Error("Output must be outside the analyzed target");
  return o;
}

export function syncDirectory(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function writeNew(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(
      fd,
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(dirname(path));
}
