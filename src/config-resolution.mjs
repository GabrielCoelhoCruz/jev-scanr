import { posix } from "node:path";
import { parse as jsonc } from "jsonc-parser";
import { hash, secretLike } from "./core.mjs";

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const contained = (path) =>
  path === "." ||
  (!posix.isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.split("/").some((part) => !part || part.startsWith(".")));
const literalPath = (path) =>
  typeof path === "string" &&
  !/[\\:\x00-\x1f]/.test(path) &&
  !path.startsWith("/") &&
  !path.includes("${");

export function externalConfigData(input, limits) {
  if (!Array.isArray(input) || input.length > 32)
    throw Error("Invalid offline external config data");
  let bytes = 0,
    count = 0;
  const specifiers = new Set(),
    identities = new Map();
  return input.map((artifact) => {
    if (
      !object(artifact) ||
      artifact.verifiedByCaller !== true ||
      ![
        "specifier",
        "package",
        "version",
        "integrity",
        "provenance",
        "entry",
      ].every(
        (key) =>
          typeof artifact[key] === "string" &&
          artifact[key].length > 0 &&
          artifact[key].length <= 2048 &&
          !/[\x00-\x1f]/.test(artifact[key]) &&
          !secretLike(artifact[key]),
      ) ||
      !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(artifact.package) ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
        artifact.version,
      ) ||
      !/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(artifact.integrity) ||
      !(
        artifact.specifier === artifact.package ||
        artifact.specifier.startsWith(artifact.package + "/")
      ) ||
      !contained(artifact.specifier) ||
      !contained(artifact.entry) ||
      !artifact.entry.endsWith(".json") ||
      !object(artifact.files) ||
      !Object.hasOwn(artifact.files, artifact.entry) ||
      specifiers.has(artifact.specifier)
    )
      throw Error("Invalid or unattested offline external config data");
    specifiers.add(artifact.specifier);
    const files = new Map();
    for (const [path, source] of Object.entries(artifact.files)) {
      if (
        !contained(path) ||
        !path.endsWith(".json") ||
        typeof source !== "string" ||
        source.includes("\0") ||
        Buffer.from(source).toString("utf8") !== source ||
        secretLike(source) ||
        Buffer.byteLength(source) > limits.maxFileBytes ||
        ++count > limits.maxFiles ||
        (bytes += Buffer.byteLength(source)) > limits.maxTotalBytes
      )
        throw Error("Unsafe or oversized offline external config data");
      const identity = `${artifact.package}@${artifact.version}/${path}`,
        sha256 = hash(Buffer.from(source));
      if (identities.has(identity) && identities.get(identity) !== sha256)
        throw Error("Conflicting offline external config data");
      identities.set(identity, sha256);
      files.set(path, { source, sha256 });
    }
    return Object.freeze({
      specifier: artifact.specifier,
      package: artifact.package,
      version: artifact.version,
      integrity: artifact.integrity,
      provenance: artifact.provenance,
      entry: artifact.entry,
      verification: "caller_attested_not_verified_by_scanner",
      files,
    });
  });
}

export function configFacts(snapshot) {
  const records = [],
    unresolved = [],
    seen = new Set(),
    artifacts = snapshot.externalConfigs ?? [],
    localCache = new Map();
  let visits = 0;
  const id = (location) =>
    location.artifact
      ? `external:${location.artifact.package}@${location.artifact.version}/${location.path}`
      : location.path;
  const issue = (location, reason) => {
    unresolved.push({ path: id(location), reason });
    return { graphUnknown: true };
  };
  const directory = (location, path = ".") => ({
    path: posix.normalize(posix.join(posix.dirname(location.path), path)),
    artifact: location.artifact,
  });
  function load(location, trail = []) {
    const key = id(location);
    if (trail.includes(key)) return issue(location, "extends_cycle");
    if (trail.length >= 8) return issue(location, "extends_depth_cap");
    if (++visits > 64) return issue(location, "extends_node_cap");
    let item;
    if (location.artifact) item = location.artifact.files.get(location.path);
    else {
      if (!snapshot.admissible(location.path))
        return issue(location, "extends_path_escape_or_excluded");
      item =
        snapshot.sources.get(location.path) ?? localCache.get(location.path);
      if (!item) {
        item = snapshot.readConfig?.(location.path);
        localCache.set(location.path, item ?? {});
      }
    }
    if (typeof item?.source !== "string")
      return issue(location, "not_in_allowlisted_snapshot");
    const errors = [],
      data = jsonc(item.source, errors, {
        allowTrailingComma: true,
        disallowComments: false,
      });
    if (errors.length || !object(data)) return issue(location, "invalid_jsonc");
    if (!seen.has(key)) {
      records.push({
        path: key,
        sha256: item.sha256,
        reason: "config_as_data_no_execution",
        ...(location.artifact
          ? {
              package: location.artifact.package,
              version: location.artifact.version,
              integrity: location.artifact.integrity,
              provenance: location.artifact.provenance,
              verification: location.artifact.verification,
            }
          : {}),
      });
      seen.add(key);
    }
    let inherited = {};
    if (data.extends !== undefined) {
      const bases = Array.isArray(data.extends) ? data.extends : [data.extends];
      if (!bases.length || bases.length > 32)
        inherited = issue(location, "invalid_or_excessive_extends");
      else
        for (const specifier of bases) {
          let base;
          if (typeof specifier !== "string" || !literalPath(specifier))
            base = issue(location, "external_or_dynamic_extends_unresolved");
          else if (specifier.startsWith(".")) {
            const target = directory(location, specifier);
            if (!target.path.endsWith(".json")) target.path += ".json";
            if (
              !contained(target.path) ||
              (!target.artifact && !snapshot.admissible(target.path))
            )
              base = issue(location, "extends_path_escape_or_excluded");
            else base = load(target, [...trail, key]);
          } else {
            const artifact = artifacts.find((a) => a.specifier === specifier);
            base = artifact
              ? load({ artifact, path: artifact.entry }, [...trail, key])
              : issue(location, "external_or_dynamic_extends_unresolved");
          }
          inherited = { ...inherited, ...base };
        }
    }
    if (data.compilerOptions === undefined) return inherited;
    if (!object(data.compilerOptions))
      return { ...inherited, ...issue(location, "invalid_compiler_options") };
    const options = data.compilerOptions;
    if (Object.hasOwn(options, "baseUrl")) {
      if (!literalPath(options.baseUrl))
        Object.assign(inherited, issue(location, "invalid_baseUrl"));
      else {
        const base = directory(location, options.baseUrl);
        if (
          !contained(base.path) ||
          (!base.artifact &&
            base.path !== "." &&
            !snapshot.admissible(base.path))
        )
          Object.assign(inherited, issue(location, "baseUrl_escape"));
        else inherited.base = base;
      }
    }
    if (Object.hasOwn(options, "paths")) {
      if (
        !object(options.paths) ||
        !Object.entries(options.paths).every(
          ([pattern, targets]) =>
            pattern.length > 0 &&
            pattern.split("*").length <= 2 &&
            Array.isArray(targets) &&
            targets.length > 0 &&
            targets.every(
              (target) => literalPath(target) && target.split("*").length <= 2,
            ),
        )
      )
        Object.assign(inherited, issue(location, "invalid_paths"));
      else {
        inherited.aliases = options.paths;
        inherited.pathsDirectory = directory(location);
      }
    }
    return inherited;
  }
  const present = (path) =>
    snapshot.sources.has(path) ||
    snapshot.files?.some((file) => file.path === path);
  const rootPath = present("tsconfig.json")
      ? "tsconfig.json"
      : present("jsconfig.json")
        ? "jsconfig.json"
        : undefined,
    config = rootPath
      ? load({ path: rootPath })
      : snapshot.coverage?.traversalComplete === false
        ? issue({ path: "tsconfig.json" }, "config_discovery_incomplete")
        : {},
    aliasOrigin = config.base ?? config.pathsDirectory ?? { path: "." };
  let unsafeTargets = false;
  if (!aliasOrigin.artifact)
    for (const targets of Object.values(config.aliases ?? {}))
      for (const target of targets) {
        const path = posix.normalize(posix.join(aliasOrigin.path, target));
        if (!contained(path) || (path !== "." && !snapshot.admissible(path)))
          unsafeTargets = true;
      }
  if (unsafeTargets)
    unresolved.push({ path: rootPath, reason: "paths_escape_or_excluded" });
  if (aliasOrigin.artifact)
    unresolved.push({ path: id(aliasOrigin), reason: "external_alias_origin" });
  return {
    ...(config.aliases ? { aliases: config.aliases } : {}),
    baseDir: config.base?.artifact ? undefined : (config.base?.path ?? "."),
    hasBaseUrl: !!config.base,
    baseUnresolved: !!config.graphUnknown || !!config.base?.artifact,
    pathsOrigin: config.pathsDirectory ? id(config.pathsDirectory) : undefined,
    aliasBase: aliasOrigin.artifact ? undefined : aliasOrigin.path,
    aliasResolutionUnknown:
      !!config.graphUnknown || !!aliasOrigin.artifact || unsafeTargets,
    records,
    unresolved,
  };
}
