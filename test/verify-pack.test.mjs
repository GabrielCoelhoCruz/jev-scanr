import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(
  new URL("../skills/verify-jev-scanr/verify.sh", import.meta.url),
);
const gnuTar = /GNU tar/.test(
  spawnSync("tar", ["--version"], { encoding: "utf8" }).stdout ?? "",
);
const realGit = execFileSync("sh", ["-c", "command -v git"], {
  encoding: "utf8",
}).trim();

function verifyPackage(t, { tracked = [], ignored = null, exclude = null }) {
  const root = mkdtempSync(join(tmpdir(), "verify-pack-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({
      name: "jev-scanr",
      version: "0.0.0",
      files: ["src", "cuts.json"],
    }),
  );
  writeFileSync(join(repo, "cuts.json"), "{}\n");
  for (const name of ["index.mjs", ...tracked])
    writeFileSync(join(repo, "src", name), "export {};\n");
  writeFileSync(join(repo, ".gitignore"), ".env*\n*.log\n");
  const git = (...args) =>
    execFileSync(realGit, ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-q",
    "-m",
    "fixture",
  );
  if (exclude) {
    mkdirSync(join(repo, ".git", "info"), { recursive: true });
    writeFileSync(join(repo, ".git", "info", "exclude"), exclude);
  }
  if (ignored) {
    const file = join(repo, "src", ignored);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "PUBLIC_SENTINEL_NOT_A_SECRET\n");
  }
  const stub = (file, body) => {
    writeFileSync(join(bin, file), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, file), 0o755);
  };
  stub(
    "git",
    `if [ "$1" = ls-remote ]; then printf '%s\\trefs/heads/main\\n' "$('${realGit}' rev-parse HEAD)"; exit 0; fi\nexec '${realGit}' "$@"`,
  );
  stub("npx", "printf 'RECORDED RUN\\n## 1. stub\\n'");
  stub("unshare", 'shift; exec "$@"');
  const sha = git("rev-parse", "HEAD");
  const proof = join(root, "proof");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  delete env.TYPESAFE_API_KEY;
  const result = spawnSync("bash", [helper, sha, proof], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stderr: result.stderr,
    listing: existsSync(join(proof, "package-files.txt"))
      ? readFileSync(join(proof, "package-files.txt"), "utf8")
      : "",
    log: existsSync(join(proof, "commands.log"))
      ? readFileSync(join(proof, "commands.log"), "utf8")
      : "",
    installed: existsSync(join(proof, "install.stdout")),
  };
}

test(
  "verify.sh accepts a package whose every file is a blob at the SHA, unusual names included",
  { skip: !gnuTar && "verify.sh lists the tarball with GNU tar" },
  (t) => {
    const run = verifyPackage(t, {
      tracked: ["trailing.mjs ", "back\\slash.mjs", "tab\there.mjs"],
    });
    assert.match(run.log, /every packed file equals its blob at [0-9a-f]{40}/);
    assert.equal(run.installed, true);
  },
);

for (const name of [
  ".env ",
  "back\\slash.log",
  "tab\there.log",
  "new\nline.log",
]) {
  test(
    `verify.sh refuses an ignored packed file named ${JSON.stringify(name)} before npm install`,
    { skip: !gnuTar && "verify.sh lists the tarball with GNU tar" },
    (t) => {
      const run = verifyPackage(t, { ignored: name });
      assert.equal(run.status, 1);
      assert.match(run.log, /^pack exit=0$/m);
      assert.doesNotMatch(run.log, /every packed file equals/);
      assert.equal(run.installed, false);
    },
  );
}

test(
  "verify.sh refuses an ignored file whose newline splits it into two tracked names before npm install",
  { skip: !gnuTar && "verify.sh lists the tarball with GNU tar" },
  (t) => {
    const run = verifyPackage(t, {
      tracked: ["core.mjs", "demo.mjs"],
      ignored: "core.mjs\npackage/src/demo.mjs",
      exclude: "/src/core.mjs?package/\n",
    });
    assert.equal(run.status, 1);
    assert.match(run.log, /^pack exit=0$/m);
    assert.equal(
      run.listing.split("\n").filter((line) => line === "package/src/core.mjs")
        .length,
      2,
    );
    assert.doesNotMatch(run.log, /every packed file equals/);
    assert.equal(run.installed, false);
    assert.match(
      run.stderr,
      /the package listing has 7 lines for 6 regular files/,
    );
  },
);
