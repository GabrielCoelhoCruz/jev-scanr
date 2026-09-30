# tsconfig files that live in packages

A `tsconfig.json` often extends a config from a package, for example `"extends": "expo/tsconfig.base"`. Its `paths` aliases (`@/…`) decide which imports the scanner can resolve. The scanner never reads `node_modules`, so a package config is unknown to it unless you supply it as **offline data**. Without it, alias imports in that project are reported as unresolved (`alias_base_or_config_graph_unresolved`) and the affected units get less context.

Supply it with `--external-configs FILE`, a JSON array of attested artifacts:

```json
[
  {
    "specifier": "expo/tsconfig.base",
    "package": "expo",
    "version": "54.0.35",
    "integrity": "sha512-…",
    "provenance": "where the file came from",
    "verifiedByCaller": true,
    "entry": "tsconfig.base.json",
    "files": { "tsconfig.base.json": "…file text…" }
  }
]
```

`verifiedByCaller: true` means _you_ checked the file matches that package version. The scanner records the package, version and integrity in the plan but does not verify them. The data is parsed as JSON with comments and is never executed. Files with secret-like content and oversized files are refused.

`scripts/pinned-config.py` builds such a file from your lockfile pin. It takes an exact public registry URL and a SHA-512 integrity from `package-lock.json`, verifies the archive against it, and extracts only the one config as data:

```sh
python3 scripts/pinned-config.py --lock ~/code/my-project/package-lock.json --package expo \
  --entry tsconfig.base.json --specifier expo/tsconfig.base --out ../expo-config
node src/cli.mjs scan ~/code/my-project --external-configs ../expo-config/external-configs.json
```

(The output directory must be outside the project.) This is optional. The daily-tracker numbers in `EVIDENCE.md` were measured with it, so on a project with a package-based `extends`, a scan without it has less context than those runs did.
