# Contributing

Thanks for helping improve `@baezel/data-module`. Bug reports, feature requests and pull requests are welcome through the [GitHub issue tracker](https://github.com/Baezel-Interactive/data-module/issues).

## Prerequisites

- Node.js 22.18 or newer (the package is ESM-only and uses `require(esm)` for CommonJS consumers).
- npm, using the committed `package-lock.json`.

## Getting started

```bash
git clone https://github.com/Baezel-Interactive/data-module.git
cd data-module
npm install
npm run verify:fast
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile `src/` to ESM `dist/` with `.d.ts` files. |
| `npm run typecheck` | Type-check the whole project without emitting. |
| `npm test` | Run unit tests with vitest and `unplugin-swc` (decorator metadata enabled). |
| `npm run test:watch` | Watch mode for unit tests. |
| `npm run test:types` | Run `expectTypeOf` type tests with vitest. |
| `npm run test:integration` | Run the Testcontainers integration suite (empty during Phase 0). |
| `npm run lint` / `npm run format` | ESLint / Prettier over `src`, `test`, `scripts`. |
| `npm run publint` / `npm run attw` | Validate package metadata and type resolution (`esm-only` profile). |
| `npm run check:no-tla` | Reject top-level await in emitted `dist`. |
| `npm run smoke:cjs` | `require()` every entry point from a packed tarball. |
| `npm run check:guard` | Verify the node guard exists and is imported by every entry point. |
| `npm run audit` / `npm run sbom` | Dependency audit and CycloneDX SBOM generation. |
| `npm run verify:gate` | Fast packaging gate: build, publint, attw, no-TLA, CJS smoke, guard check. |
| `npm run verify:fast` | `verify:gate` plus typecheck, lint, unit and type tests. Use constantly. |
| `npm run verify` | Full local gate: `verify:fast`, integration containers/driver matrices, audit, SBOM. Required before release. |

`prepublishOnly` runs `verify:gate` so a publish cannot ship a stale `dist`; Testcontainers stay out of it. `prepack` also rebuilds `dist`. `dist/`, `sbom.json` and `.verify-*` directories are generated and gitignored — never edit or commit them.

There is **no CI service**. Verification runs on the maintainer's machine, and `npm audit` results are point-in-time from that machine. Attach the generated `sbom.json` to the GitHub release by hand.

## Project structure

- `src/` — library source. `index.ts` is the root entry point; `prisma/index.ts` and `typeorm/index.ts` are subpath entry points. `runtime/node-guard.ts` enforces the Node floor and is imported by every entry. `config/` holds zod schemas and BYOC registration normalization, `errors/` holds the typed error taxonomy and redaction helpers, `hooks/` holds the experimental event interface, `entities/` handles compiled-JS glob loading and entity resolution, `provisioning/` handles boot-time database creation for Postgres/MySQL and connectivity checks for Mongo, and `typeorm/entities.ts` reads TypeORM decorator metadata, `mongo/` holds the native MongoDB connector, and `transactions/` holds the shared retry policy, and `safety/` holds the production gate, best-effort SQL guard, checksum helper and migration lock primitives, `migrations/` holds the runner and tracking stores, `cli/` holds the `baezel-data` binary, `otel/` holds the optional tracing hooks, and `pool/`, `lifecycle/` and `resilience/` hold connection tuning, bounded shutdown and cockatiel policies. Connectors implement `OnApplicationShutdown`; call `enableShutdownHooks()` in the consuming Nest app.
- `test/` — vitest tests importing from `../src/*.js`, plus `test/types/*.test-d.ts`.
- `scripts/check-package.mjs` — packed-tarball smoke, guard and no-TLA checks.
- `dist/` — generated ESM build plus `.d.ts` files, included in the published tarball.

## Testing conventions

- Tests import `{ describe, it, expect, vi }` from vitest. Use `vi.fn()` and `vi.mock()`; `vi.hoisted()` for mock state used inside mock factories.
- Import `reflect-metadata` first in tests that compile Nest decorators.
- Mock optional dependencies instead of requiring live databases. Integration tests use Testcontainers with single-node replica-set Mongo.
- Type tests live in `test/types/*.test-d.ts` and use `expectTypeOf`.
- Testcontainers integration tests in `test/integration/` are skipped unless `RUN_DB_INTEGRATION=1` and Docker is available. Mongo runs as a single-node replica set so sessions/transactions work. Run the full suite with `RUN_DB_INTEGRATION=1 npm run verify`.

## Code style

- Prettier: single quotes, trailing commas, `printWidth: 115` (`.prettierrc`).
- ESLint: flat config with `typescript-eslint` and the Prettier plugin (`eslint.config.js`).
- Run `npm run verify:fast` before opening a pull request.

## Pull requests

1. Create a focused branch and keep changes small.
2. Add or update tests and documentation for public behavior changes.
3. Verify locally with `npm run verify:fast`.
4. Open a pull request describing the change and link the related issue.
5. Do not bump the package version in a feature PR; releases are handled by maintainers.

## Versioning and tags

Versions follow semver. Annotated git tags match `package.json` exactly; npm dist-tags are assigned manually:

| Version | npm dist-tag |
| --- | --- |
| `1.0.0-dev.N` | `dev` |
| `1.0.0-alpha.N` | `alpha` |
| `1.0.0-beta.N` | `beta` |
| `1.0.0-rc.N` | `rc` |
| `1.0.0` and newest-line hotfixes | `latest` |
| Older-line hotfixes | `release-1.0` |

`dev` snapshots remain on the registry and the `dev` tag is overwritten at each publish. Hotfix branches are named `release/<major>.<minor>.x`; nothing enforces this automatically, so the checklist below is mandatory. OIDC provenance is deferred and would require reintroducing CI.

## Releasing (manual, maintainers only)

Publishing requires rights to the `@baezel` npm scope and two-factor authentication for writes.

1. Confirm a clean tree: `git status`.
2. Confirm the release tag is checked out and matches the version:

   ```bash
   test "$(git describe --tags --exact-match)" = "v$(node -p "require('./package.json').version")"
   ```

3. Run the full gate: `npm run verify`.
4. Publish with an explicit tag (npm refuses untagged prereleases, but a wrong `--tag latest` on a prerelease is not refused):

   ```bash
   npm publish --tag dev      # 1.0.0-dev.N
   npm publish --tag alpha    # 1.0.0-alpha.N
   npm publish --tag beta     # 1.0.0-beta.N
   npm publish --tag rc       # 1.0.0-rc.N
   npm publish --tag latest   # 1.0.0 and newest-line hotfixes only
   ```

5. Immediately check `npm dist-tag ls @baezel/data-module` and `npm view @baezel/data-module version`.
6. Attach `sbom.json` to the GitHub release. Deprecate older versions with `npm deprecate` when appropriate.

## License

By contributing you agree that your contributions are licensed under the MIT License.
