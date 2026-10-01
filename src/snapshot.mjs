import {
  readdirSync,
  lstatSync,
  realpathSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  constants,
} from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { hash, secretLike } from "./core.mjs";
import { configFacts, externalConfigData } from "./config-resolution.mjs";

export const LIMITS = Object.freeze({
  maxFiles: 500,
  maxEntries: 10000,
  maxFileBytes: 524288,
  maxTotalBytes: 16777216,
  maxFunctions: 12000,
  maxComparisons: 500000,
  maxCandidates: 2000,
  maxRequestBytes: 24000,
  maxHardRequestBytes: 64000,
  maxCallers: 3,
  maxImports: 8,
  maxTests: 2,
});
const directories = new Set([
  "node_modules",
  "vendor",
  "vendors",
  "dist",
  "build",
  "coverage",
  "generated",
  "__generated__",
  "out",
  "target",
]);
export const sourcePath = (path) =>
  /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
export const testPath = (path) =>
  /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
    path,
  );

export function safeRelative(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !path.split("/").some((x) => x === ".." || x === "" || x.startsWith("."))
  );
}
export function readSnapshot(
  root,
  { excluded = [], limits = {}, externalConfigs = [], paths = [] } = {},
) {
  root = realpathSync(root);
  limits = { ...LIMITS, ...limits };
  for (const [key, value] of Object.entries(limits))
    if (
      !(key in LIMITS) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > LIMITS[key]
    )
      throw Error("Invalid lowered limit");
  if (limits.maxHardRequestBytes < limits.maxRequestBytes)
    throw Error("maxHardRequestBytes must not be below maxRequestBytes");
  excluded = [...new Set(excluded)].sort();
  if (excluded.some((p) => !safeRelative(p)))
    throw Error("Unsafe exclusion path");
  paths = [...new Set(paths)].sort();
  if (paths.some((p) => !safeRelative(p)))
    throw Error("Unsafe scan path (use paths relative to the project)");
  for (const p of paths) {
    let stat;
    try {
      stat = lstatSync(resolve(root, p));
    } catch {
      throw Error(`--paths: ${p} does not exist in the project`);
    }
    if (stat.isSymbolicLink()) throw Error(`--paths: ${p} is a symlink`);
  }
  const inScope = (path) =>
    !paths.length || paths.some((p) => path === p || path.startsWith(p + "/"));
  externalConfigs = externalConfigData(externalConfigs, limits);
  const files = [],
    sources = new Map();
  let entries = 0,
    bytes = externalConfigs.reduce(
      (sum, artifact) =>
        sum +
        [...artifact.files.values()].reduce(
          (total, item) => total + Buffer.byteLength(item.source),
          0,
        ),
      0,
    ),
    readFiles = externalConfigs.reduce(
      (sum, artifact) => sum + artifact.files.size,
      0,
    );
  const admissible = (path) =>
    safeRelative(path) &&
    !excluded.some((p) => path === p || path.startsWith(p + "/")) &&
    !path.split("/").some((p) => directories.has(p)) &&
    !/(?:secret|credential|\.min\.|\.generated\.)/i.test(path);
  const read = (path) => {
    if (!admissible(path)) return { status: "excluded_path" };
    const full = resolve(root, path);
    if (!full.startsWith(root + sep)) return { status: "path_escape" };
    let cursor = root;
    try {
      for (const segment of relative(root, full).split(sep)) {
        cursor = join(cursor, segment);
        if (lstatSync(cursor).isSymbolicLink()) return { status: "symlink" };
      }
    } catch {
      return { status: "missing_or_unreadable" };
    }
    let fd;
    try {
      fd = openSync(
        full,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1)
        return { status: "non_regular_or_multilink" };
      if (
        readFiles >= limits.maxFiles ||
        stat.size > limits.maxFileBytes ||
        bytes + stat.size > limits.maxTotalBytes
      )
        return { status: "file_or_byte_limit" };
      const buffer = Buffer.alloc(
        Math.min(limits.maxFileBytes, limits.maxTotalBytes - bytes) + 1,
      );
      let used = 0,
        n;
      while (
        used < buffer.length &&
        (n = readSync(fd, buffer, used, buffer.length - used, null))
      )
        used += n;
      readFiles++;
      bytes += used;
      if (used > limits.maxFileBytes || bytes > limits.maxTotalBytes)
        return { status: "file_changed_exceeds_limit" };
      const data = buffer.subarray(0, used),
        source = data.toString("utf8");
      if (data.includes(0) || !Buffer.from(source).equals(data))
        return { status: "binary_or_invalid_utf8" };
      if (secretLike(source))
        return { status: "potential_secret_no_content_stored" };
      if (
        /(?:^|\n)\s*(?:\/\/|\/\*|\*)[^\n]*(?:@generated|auto.generated|DO NOT EDIT)/i.test(
          source.slice(0, 4096),
        )
      )
        return { status: "generated" };
      return { status: "read", source, sha256: hash(data), bytes: used };
    } catch {
      return { status: "unreadable" };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  function visit(dir, prefix = "") {
    let children;
    try {
      children = readdirSync(dir).sort();
    } catch {
      files.push({ path: prefix, status: "unreadable_directory" });
      return;
    }
    for (const [i, name] of children.entries()) {
      if (entries >= limits.maxEntries) {
        files.push({
          path: prefix || ".",
          status: "entry_limit",
          unvisitedEntries: children.length - i,
        });
        return;
      }
      entries++;
      const path = prefix ? `${prefix}/${name}` : name;
      if (!admissible(path)) {
        files.push({ path, status: "excluded_path" });
        continue;
      }
      let stat;
      try {
        stat = lstatSync(join(dir, name));
      } catch {
        files.push({ path, status: "unreadable" });
        continue;
      }
      if (stat.isSymbolicLink()) {
        files.push({ path, status: "symlink" });
        continue;
      }
      if (stat.isDirectory()) {
        visit(join(dir, name), path);
        continue;
      }
      if (
        !sourcePath(path) &&
        !/^(?:tsconfig[^/]*|jsconfig)\.json$/.test(name)
      ) {
        files.push({ path, status: "non_source" });
        continue;
      }
      if (sourcePath(path) && !inScope(path)) {
        files.push({ path, status: "outside_paths" });
        continue;
      }
      const result = read(path),
        { source, ...record } = result;
      files.push({ path, ...record });
      if (source !== undefined) sources.set(path, { path, ...result });
    }
  }
  visit(root);
  const sourceFiles = files.filter((f) => sourcePath(f.path));
  const snapshot = {
    root,
    limits,
    excluded,
    files,
    sources,
    read,
    admissible,
    externalConfigs,
    paths,
    coverage: {
      sourceFiles: {
        inProject: sourceFiles.length,
        inScope: sourceFiles.filter((f) => f.status !== "outside_paths").length,
        read: sourceFiles.filter((f) => f.status === "read").length,
        unreadByFileOrByteCap: sourceFiles.filter(
          (f) => f.status === "file_or_byte_limit",
        ).length,
      },
      entriesVisited: entries,
      traversalComplete: !files.some((f) => f.status === "entry_limit"),
      filesRead: readFiles,
      sourceBytesRead: bytes,
      snapshotAtomic: false,
    },
  };
  snapshot.readConfig = (path) => {
    if (!path.endsWith(".json"))
      return { status: "unsupported_config_extension" };
    if (sources.has(path)) return sources.get(path);
    const result = read(path);
    const { source, ...record } = result;
    files.push({ path, ...record });
    if (source !== undefined) sources.set(path, { path, ...result });
    snapshot.coverage.filesRead = readFiles;
    snapshot.coverage.sourceBytesRead = bytes;
    return result;
  };
  return snapshot;
}

export function tsconfigFacts(snapshot) {
  return configFacts(snapshot);
}
