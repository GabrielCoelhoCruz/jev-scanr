import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const credentialsPath = (env = process.env) =>
  join(
    env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"),
    "jev-refactor",
    "credentials.json",
  );

export function resolveApiKey(env = process.env) {
  if (env.TYPESAFE_API_KEY) return env.TYPESAFE_API_KEY;
  const file = credentialsPath(env);
  if (!existsSync(file)) return null;
  if (statSync(file).mode & 0o077)
    throw Error(
      `${file} is readable by other users. Run chmod 600 on it, or run jr auth again.`,
    );
  const { apiKey } = JSON.parse(readFileSync(file, "utf8"));
  return typeof apiKey === "string" && apiKey ? apiKey : null;
}

export function saveApiKey(apiKey, env = process.env) {
  if (!/^\S{8,}$/.test(apiKey))
    throw Error(
      "That does not look like an API key (no spaces, 8+ characters)",
    );
  const file = credentialsPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ apiKey }) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export function removeApiKey(env = process.env) {
  const file = credentialsPath(env);
  const existed = existsSync(file);
  rmSync(file, { force: true });
  return { file, existed };
}

export function readSecret(
  prompt,
  { input = process.stdin, output = process.stderr } = {},
) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      let data = "";
      input.setEncoding("utf8");
      input.on("data", (c) => (data += c));
      input.on("end", () => resolve(data.trim()));
      input.on("error", reject);
      return;
    }
    output.write(prompt);
    let value = "";
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const done = (fn, arg) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
      fn(arg);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(resolve, value.trim());
        if (ch === "\u0003") return done(reject, Error("Cancelled"));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.on("data", onData);
  });
}
