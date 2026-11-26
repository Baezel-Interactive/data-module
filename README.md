# @baezel/data-module

Pluggable NestJS database module with a driver-agnostic connector contract. The core package has no ORM dependency; use the optional `/prisma` or `/typeorm` subpaths for the connector you need.

[![npm version](https://img.shields.io/npm/v/@baezel/data-module)](https://www.npmjs.com/package/@baezel/data-module)
[![license](https://img.shields.io/npm/l/@baezel/data-module)](https://www.npmjs.com/package/@baezel/data-module)

**Links:** [npm](https://www.npmjs.com/package/@baezel/data-module) · [Repository](https://github.com/Baezel-Interactive/data-module) · [Issues](https://github.com/Baezel-Interactive/data-module/issues) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## Install

```bash
npm install @baezel/data-module
```

Peer dependencies: `@nestjs/common` and `reflect-metadata`. Install `typeorm` only if you use the `/typeorm` subpath:

```bash
npm install @baezel/data-module typeorm
```

For Prisma, you provide your own generated client, so this package installs no Prisma packages for you. Optional peers are only needed for the feature you use: `@prisma/client` for `/prisma`, `mongodb` for the native Mongo connector, `@nestjs/core` for decorator-based entity discovery, and `@opentelemetry/api` for the tracing subpath.

## Requirements

- NestJS 10, 11 or 12, with `reflect-metadata` loaded once at application startup.
- TypeScript with `experimentalDecorators` and `emitDecoratorMetadata` enabled.
- Node.js 22.18 or newer. The package is ESM-only with `types` + `default` export conditions; CommonJS consumers are supported through Node's `require(esm)`, which is smoke-tested. There is no top-level await anywhere in the dependency graph.

## Entry points

| Import | Exports |
| --- | --- |
| `@baezel/data-module` | `DbModule`, `DbService`, `DB_CONNECTOR`, `DB_MODULE_OPTIONS`, `IDbConnector`, `IRepository`, `DbEntity`, `DbModuleOptions`, `DbModuleAsyncOptions`, `DbConnectorFactory` |
| `@baezel/data-module/mongo` | `MongoConnector`, `MongoConnectorOptions` |
| `@baezel/data-module/otel` | `OpenTelemetryHooks` (optional `@opentelemetry/api` peer; experimental until RC) |
| `@baezel/data-module/prisma` | `PrismaConnector`, `PrismaConnectorOptions`, `PrismaLikeClient` |
| `@baezel/data-module/typeorm` | `TypeOrmConnector` |

The root entry also exports config schemas and types (`driverRegistrationSchema`, `DbDriver`, `DriverRegistrationInput`), typed errors and redaction helpers (`DbConfigError`, `DbProvisioningError`, `DbConnectionError`, `DbDestructiveOperationError`, `normalizeDbError`, `redactString`), and the experimental `Hooks` interface. Hooks payloads never contain bound parameters.

## Core usage

```ts
import { Module } from '@nestjs/common';
import { DbModule } from '@baezel/data-module';
import { TypeOrmConnector } from '@baezel/data-module/typeorm';

@Module({
  imports: [
    DbModule.register({
      connector: new TypeOrmConnector({
        type: 'postgres',
        host: 'localhost',
        database: 'app',
        entities: [User],
      }),
    }),
  ],
})
export class AppModule {}
```

Async configuration from `ConfigService`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DbModule } from '@baezel/data-module';
import { TypeOrmConnector } from '@baezel/data-module/typeorm';

@Module({
  imports: [
    DbModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connector: new TypeOrmConnector({
          type: 'postgres',
          url: config.get('DATABASE_URL'),
          entities: [User],
        }),
      }),
    }),
  ],
})
export class AppModule {}
```

`registerAsync` also supports `useClass` and `useExisting` with a `DbConnectorFactory`.

`DbService` is global and injectable anywhere:

```ts
constructor(private readonly db: DbService) {}

findUsers() {
  return this.db.getRepository<User>('User').findMany();
}
```

Connectors supplied to `register()` or returned from `registerAsync()` receive `onModuleInit()` and `onApplicationShutdown()`; call `app.enableShutdownHooks()` so Nest delivers the shutdown hook. The library registers no signal handlers itself.

The connector contract is intentionally small but covers common persistence work:

```ts
interface IRepository<T> {
  findMany(options?: FindOptions<T>): Promise<T[]>;
  findOne(id: string | number, options?: RepositoryOptions): Promise<T | null>;
  count(where?: Partial<T>): Promise<number>;
  create(data: Partial<T>): Promise<T>;
  update(id: string | number, data: Partial<T>): Promise<T | null>;
  delete(id: string | number): Promise<boolean>;
  upsert(data: Partial<T>, options: UpsertOptions<T>): Promise<T>;
}

interface IDbConnector {
  getRepository<T>(entity: DbEntity<T>, options?: RepositoryOptions): IRepository<T>;
}
```

`RepositoryOptions.idType` declares how IDs are interpreted: `objectId` (Mongo default), `string`, `number` or `uuid`. Mongo converts hex strings to `ObjectId` only for `objectId` and passes other types through. `upsert` always requires a `conflictTarget` (`email`, `['tenantId', 'email']`, etc.) so behavior does not diverge silently between Postgres `ON CONFLICT`, MySQL `ON DUPLICATE KEY` and Mongo `upsert: true`.

For custom backends implement `IDbConnector` and pass it to `DbModule.register({ connector })`. Optional contracts `ITransactionalConnector` and `IHealthCheckConnector` add `transaction()` and `ping()`/`getHealth()`. `transaction()` retries the whole callback on transient errors with a capped attempt count, so callbacks must be idempotent. Mongo delegates retries to `session.withTransaction` and never wraps them in a second retry. `ping()` uses a dedicated short-timeout query so a saturated pool cannot stall a health endpoint. Both `register` and `registerAsync` also accept a config-driven registration, where zod validates the config and your factory receives the validated context:

```ts
DbModule.register({
  kind: 'driver',
  driver: 'postgres',
  config: { host: 'localhost', database: 'app' },
  connectorFactory: ({ config, logger }) => new MyConnector(config, logger),
});
```

The factory context provides `driver`, `config`, `safety`, `provisioning`, `environment`, `hooks` and a Nest `Logger`. A connector factory is currently required; built-in provisioning and connector factories arrive in later phases.

## Prisma connector

The package never imports or generates a Prisma client. Construct your own client (with the driver adapter required by Prisma 7) and pass it in:

```ts
import { Module } from '@nestjs/common';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DbModule } from '@baezel/data-module';
import { PrismaConnector } from '@baezel/data-module/prisma';

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

@Module({
  imports: [DbModule.register({ connector: new PrismaConnector({ client }) })],
})
export class AppModule {}
```

`PrismaConnector` calls `$connect()`/`$disconnect()` on your client via Nest lifecycle hooks. Model names are resolved from the entity name or string (e.g. `User` → `client.user`), and `findOne(id)` uses `findUnique({ where: { id } })`, so it assumes a primary key named `id`.

## TypeORM connector

```ts
import { TypeOrmConnector } from '@baezel/data-module/typeorm';

const connector = new TypeOrmConnector({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User],
  migrations: [InitUserMigration],
  synchronize: false,
});
```

It initializes and destroys the `DataSource` on Nest lifecycle hooks; `getDataSource()` exposes it for CLI/migration use. `findOne(id)` uses `findOneBy({ id })`.

## Mongo connector

The native Mongo connector uses the optional `mongodb` peer (driver 6+):

```ts
import { MongoConnector } from '@baezel/data-module/mongo';

const connector = new MongoConnector({ url: process.env.MONGO_URL, database: 'app' });
```

It compiles collection names from entity names using the same lower-camel rule as the Prisma connector. By default IDs are treated as hex `ObjectId` strings; pass `{ idType: 'string' }`, `'number'` or `'uuid'` to `getRepository()` for other `_id` types. `transaction()` uses `session.withTransaction`, so it requires a replica set and performs no additional retry around the driver's own transient handling.

## Entity autoload

Driver registrations can autoload entities from compiled JavaScript glob patterns and, optionally, TypeORM decorator metadata:

```ts
DbModule.register({
  kind: 'driver',
  driver: 'postgres',
  config: { host: 'localhost', database: 'app' },
  entities: { glob: ['dist/**/*.entity.js'], discoverDecorators: true },
  connectorFactory: ({ resolvedEntities }) => new MyConnector(resolvedEntities?.targets),
});
```

Glob patterns must point to compiled `.js` files — TypeScript entity files cannot be loaded with native type stripping because decorators are not erasable. The startup log reports the resolved entity count and how many came from globs versus decorators. SQL drivers fail fast if autoload is requested but yields zero entities; Mongo may legitimately have none. `discoverDecorators` requires the optional `typeorm` peer.

## Safety

All destructive and unsafe options are off by default and are blocked outright when the effective environment is `production`:

| Flag | Enables |
| --- | --- |
| `allowSchemaSync` | TypeORM schema synchronization |
| `allowDropSchema` | Dropping a schema before synchronization |
| `allowDropDatabase` | Dropping a database |
| `allowDestructiveMigrations` | SQL that the migration guard classifies as destructive |
| `allowInsecureTls` | `rejectUnauthorized: false` in driver options |
| `exposeDataSource` | Returning the raw TypeORM `DataSource` from `getDataSource()` |

`environment` defaults to `NODE_ENV` and can be overridden for dev/staging, but a non-production override while `NODE_ENV=production` logs a warning and emits an `environment:override` hook event; production hard-fails still apply. Disabling TLS verification requires `allowInsecureTls` and always warns. The raw `DataSource` is hidden unless `exposeDataSource` is set.

The migration SQL guard is best-effort only: it inspects statements intercepted at `queryRunner.query`, strips comments and string literals, and refuses `DROP`, `TRUNCATE`, `DELETE FROM` and `ALTER TABLE … DROP` unless the flag or a per-migration override is present. It is not a security boundary — review migrations.

Migration concurrency primitives use a Postgres advisory lock, a MySQL `GET_LOCK` (with `RELEASE_LOCK` on disconnect), and a Mongo unique lock document whose `expiresAt` is checked by the acquirer, extended by a heartbeat, and cleaned up by a TTL index. Migration checksums hash line-ending-normalized source. MySQL DDL is not transactional, so migrations there cannot be rolled back automatically.

## Provisioning

Driver-based registrations can create a missing database at boot. `provisioning.createIfMissing` defaults to `true` outside production and `false` in production; set it explicitly to override. Postgres connects to a maintenance database (`postgres`, falling back to `template1`) and runs `CREATE DATABASE`; MySQL runs `CREATE DATABASE IF NOT EXISTS … CHARACTER SET utf8mb4`. Concurrent boots and duplicate-create races are treated as success. Creation is reported through the Nest `Logger` and hook events; credentials are never logged.

```ts
DbModule.register({
  kind: 'driver',
  driver: 'postgres',
  config: {
    host: 'localhost',
    port: 5432,
    database: 'app',
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  provisioning: { createIfMissing: true, timeoutMs: 5000, retries: 2, maintenanceDatabase: 'postgres' },
  connectorFactory: ({ config }) => new MyConnector(config),
});
```

For `mongodb`, provisioning only verifies connectivity and logs that the database is created lazily on first write; setting `createIfMissing: true` emits a warning because it is SQL-only. Boot provisioning needs credentials with database-creation privileges — pre-create the database and set `createIfMissing: false` when that privilege is not available.

## Pooling, timeouts and resilience

Driver registrations accept `pool`, `timeouts`, `driverOptions` and `resilience`. A uniform pool subset (`min`, `max`, `acquireTimeoutMs`, `idleTimeoutMs`, `statementTimeoutMs`) is mapped per driver, with `driverOptions` as an escape hatch for driver-specific settings; Mongo has no `queueLimit`. `timeouts.connectMs/queryMs/shutdownMs` bound startup, queries and graceful shutdown. Shutdown races the driver close against `shutdownMs` and then forces it.

`resilience` configures cockatiel-backed retries and a circuit breaker. Retries apply only to operations declared idempotent and only to transient/connection failures; transient retries happen inside the breaker, so they do not trip it. Breakers are keyed per connector name. `transaction()` remains governed by the Phase 4 retry rules.

## Migrations, seed and status CLI

The package installs a `baezel-data` binary. Create a `baezel-data.config.ts` (erasable syntax only) with a default export:

```ts
export default {
  driver: 'postgres',
  config: { host: 'localhost', database: 'app' },
  migrations: ['dist/migrations/*.js'],
  seeds: ['dist/seeds/*.js'],
};
```

```bash
baezel-data status --offline
baezel-data status
baezel-data migrate
baezel-data seed
```

Migration files export `up(context)`; seed files export `seed(context)` or `up(context)`. Applied migrations are tracked with checksums of line-ending-normalized source, so editing an applied migration fails loudly. Migration runs are serialized with the Postgres/MySQL/Mongo locks described above, and SQL is checked by the best-effort destructive guard. Seeds are blocked unless `safety.allowSeed` is set outside production.

## OpenTelemetry

`@baezel/data-module/otel` exports `OpenTelemetryHooks`, an implementation of the experimental `Hooks` interface that emits spans via the optional `@opentelemetry/api` peer. It stays experimental through the 1.0 betas; semantic attribute names may change before RC.

## Contributing

Bug reports, feature requests and pull requests are welcome via the [issue tracker](https://github.com/Baezel-Interactive/data-module/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and workflow details.

## Development

```bash
npm install
npm run verify:fast # build, packaging, ESM/CJS smoke, typecheck, lint, unit and type tests
npm run verify      # full local suite: verify:fast + containers, matrices, audit, SBOM
npm pack --dry-run  # preview the published file list
```

There is no CI service: all verification is run locally. `npm run verify:gate` is the fast subset wired to `prepublishOnly`; `npm run verify` is the full gate required before a release. See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete checklist.

## Publishing (maintainer)

Publishing is manual. Ensure you are logged in with publish rights (`npm whoami`); `publishConfig.access` is `public`, so no scope flag is needed. `prepublishOnly` runs a fast gate (build, publint, attw, no-TLA, CJS require smoke, guard check) and `prepack` rebuilds `dist`.

Before publishing: confirm a clean tree, confirm `HEAD` is the annotated release tag, confirm `test "$(git describe --tags --exact-match)" = "v$(node -p "require('./package.json').version")"`, and run `npm run verify`. Then publish with an explicit tag and enter the 2FA OTP:

```bash
npm publish --tag dev      # 1.0.0-dev.N
npm publish --tag alpha    # 1.0.0-alpha.N
npm publish --tag beta     # 1.0.0-beta.N
npm publish --tag rc       # 1.0.0-rc.N
npm publish --tag latest   # 1.0.0 and newest-line hotfixes only
```

Run `npm dist-tag ls @baezel/data-module` immediately after each publish. Older-line hotfixes use `--tag release-1.0` so `latest` never moves backward. Verify with `npm view @baezel/data-module`.

## License

MIT
