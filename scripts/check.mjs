import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

for (const directory of ["src", "test", "scripts", "evals", "evals/lib"])
  for (const file of readdirSync(new URL(`../${directory}/`, import.meta.url)))
    if (file.endsWith(".mjs"))
      execFileSync(
        process.execPath,
        [
          "--check",
          new URL(`../${directory}/${file}`, import.meta.url).pathname,
        ],
        { stdio: "inherit" },
      );
execFileSync(
  process.execPath,
  [
    new URL("../node_modules/prettier/bin/prettier.cjs", import.meta.url)
      .pathname,
    "--check",
    "src",
    "test",
    "scripts",
    "evals",
    "signals",
    "catalog.json",
    "cuts.json",
    "package.json",
  ],
  { stdio: "inherit", cwd: new URL("../", import.meta.url).pathname },
);
console.log("syntax and formatting checks passed");
