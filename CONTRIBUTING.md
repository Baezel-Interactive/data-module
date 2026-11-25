# Contributing

Thanks for helping improve `@baezel/data-module`. Bug reports, feature requests and pull requests are welcome through the [GitHub issue tracker](https://github.com/Baezel-Interactive/data-module/issues).

## Prerequisites

- A current Node.js LTS release compatible with the NestJS 12 / TypeScript 6 dev toolchain.
- npm (use the committed `package-lock.json` for reproducible installs).

## Getting started

```bash
git clone https://github.com/Baezel-Interactive/data-module.git
cd data-module
npm install
npm test
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile `src/` to `dist/` with declarations (`tsc -p tsconfig.build.json`). |
| `npm test` | Run the Jest suite with Node's `--experimental-vm-modules` flag. |
| `npm run test:watch` | Run Jest in watch mode. |
| `npm run lint` | Lint `src/` and `test/` with ESLint. |
| `npm run format` | Apply Prettier formatting to `src/` and `test/`. |
| `npm pack --dry-run` | Preview the exact files that would be published. |

Two npm lifecycle scripts protect releases: `prepublishOnly` runs lint and tests before a publish, and `prepack` rebuilds `dist/` from source. `dist/` is gitignored and generated, so never commit or edit it by hand.

## Project structure

- `src/` — library source. `index.ts` is the root entry point; `prisma/index.ts` and `typeorm/index.ts` are the optional subpath entry points.
- `test/` — Jest tests (`core.ts`, `prisma.ts`, `typeorm.ts`).
- `dist/` — generated CommonJS build plus `.d.ts` files; included in the published tarball.
- `package.json` — `exports` map, `files` whitelist, peer dependencies and scripts. Note that TypeORM is an optional peer dependency and the Prisma client is always supplied by the consumer.

## Testing conventions

- Tests live in `test/*.ts` and import from `../src` so they exercise the source directly.
- Import `reflect-metadata` first in tests that compile Nest decorators.
- Mock optional dependencies instead of requiring live databases: see `test/typeorm.ts` for the `jest.mock('typeorm', ...)` pattern and `test/prisma.ts` for a fake Prisma-like client.
- Add tests for new connectors, lifecycle hooks and module registration paths.

## Code style

- Prettier: single quotes, trailing commas, `printWidth: 115` (see `.prettierrc`).
- ESLint: flat config with `typescript-eslint` and the Prettier plugin (see `eslint.config.js`).
- Run `npm run format` and `npm run lint` before opening a pull request.

## Pull requests

1. Create a branch for your change and keep it focused.
2. Add or update tests and documentation (including `README.md` when public behavior changes).
3. Verify locally: `npm run lint && npm test && npm run build`.
4. Open a pull request describing the change and link the related issue.
5. Do not bump the package version in a feature PR; releases are handled by maintainers.

## Releasing (maintainers)

Publishing requires rights to the `@baezel` npm scope and two-factor authentication for writes. From a clean `main` checkout:

```bash
npm version <patch|minor|major>
npm publish
git push --follow-tags
```

Confirm the release with `npm view @baezel/data-module` and a fresh install in a scratch project.

## License

By contributing you agree that your contributions are licensed under the MIT License.
