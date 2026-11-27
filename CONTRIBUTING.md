# Contributing

Thanks for helping improve `@baezel/data-module`. Bug reports, feature requests and pull requests are welcome through the [GitHub issue tracker](https://github.com/Baezel-Interactive/data-module/issues).

## Prerequisites

- Node.js 22.18 or newer.
- npm, using the committed `package-lock.json`.
- Docker is required only for `RUN_DB_INTEGRATION=1 npm run verify`.

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
| `npm run build` | Compile `src/` to ESM `dist/` with `.d.ts`. |
| `npm run typecheck` | Type-check without emitting. |
| `npm test` | Run unit tests with vitest and `unplugin-swc`. |
| `npm run test:watch` | Watch unit tests. |
| `npm run test:types` | Run `expectTypeOf` type tests. |
| `npm run test:integration` | Run env-gated Testcontainers tests. |
| `npm run lint` / `npm run format` | ESLint / Prettier over `src`, `test`, `scripts`. |
| `npm run publint` / `npm run attw` | Package and type-resolution validation. |
| `npm run check:root-peers` | Validate the root entry's static import graph contains no optional peers. |
| `npm run check:no-tla` | Reject top-level await in `dist`. |
| `npm run smoke:cjs` | Require every entry point from a packed tarball and run the CLI shim. |
| `npm run check:guard` | Verify the node guard is emitted and imported. |
| `npm run audit` / `npm run sbom` | Dependency audit and CycloneDX SBOM generation. |
| `npm run verify:gate` | Fast packaging gate used by `prepublishOnly`. |
| `npm run verify:fast` | `verify:gate` plus typecheck, lint, unit and type tests. |
| `npm run verify` | Full local gate including containers, audit and SBOM. |

There is no CI service. `prepublishOnly` runs `verify:gate`; `prepack` rebuilds `dist`. Generated `dist/`, `sbom.json` and `.verify-*` / `.baezel-data-*` directories are gitignored.

## Project structure

- `src/config` — `dbOptions` schemas and registration normalization.
- `src/factories` — connector scaffolding from `dbOptions`.
- `src/migration-runner` — ORM-aware command dispatcher.
- `src/cli` — `baezel-data` command surface.
- `src/response` — UUID identity and output redaction.
- `src/errors`, `src/hooks`, `src/entities`, `src/provisioning`, `src/pool`, `src/lifecycle`, `src/resilience`, `src/safety`, `src/transactions` — supporting infrastructure.
- `src/typeorm`, `src/prisma`, `src/mongo`, `src/otel` — connector and integration entry points.
- `test/` — vitest suites and fixtures; `test/integration/` requires Docker and `RUN_DB_INTEGRATION=1`.

## Testing conventions

- Import vitest globals explicitly.
- Use `vi.fn()` and `vi.mock()`; use `vi.hoisted()` for mock state used in factories.
- Import `reflect-metadata` first in tests that compile Nest decorators.
- Mock optional drivers instead of requiring live databases; integration tests use Testcontainers with a single-node Mongo replica set.
- Type tests live in `test/types/*.test-d.ts`.

## Code style

- Prettier: single quotes, trailing commas, `printWidth: 115`.
- ESLint: flat config with `typescript-eslint` and the Prettier plugin.
- Run `npm run verify:fast` before opening a pull request.

## Pull requests

1. Keep changes focused.
2. Add or update tests and docs for public behavior changes.
3. Run `npm run verify:fast`.
4. Describe the change and link the related issue.
5. Do not bump the package version in a feature PR.

## Releasing (manual, maintainers only)

Publishing requires npm scope rights and two-factor authentication. Before publishing:

```bash
git status
test "$(git describe --tags --exact-match)" = "v$(node -p "require('./package.json').version")"
npm run verify
npm publish --tag dev
npm dist-tag ls @baezel/data-module
npm view @baezel/data-module version
```

Attach `sbom.json` to the GitHub release by hand. Never publish a prerelease with `--tag latest`.

## License

By contributing you agree that your contributions are licensed under the MIT License.
