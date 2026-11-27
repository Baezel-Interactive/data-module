# @baezel/data-module

Pluggable NestJS database module with a driver-agnostic connector contract. The core package has no ORM dependency; choose TypeORM, Prisma or the native Mongo connector through `dbOptions`.

[![npm version](https://img.shields.io/npm/v/@baezel/data-module)](https://www.npmjs.com/package/@baezel/data-module)
[![license](https://img.shields.io/npm/l/@baezel/data-module)](https://www.npmjs.com/package/@baezel/data-module)

Migration guide: [MIGRATION.md](MIGRATION.md)

**Links:** [npm](https://www.npmjs.com/package/@baezel/data-module) · [Repository](https://github.com/Baezel-Interactive/data-module) · [Issues](https://github.com/Baezel-Interactive/data-module/issues) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## Install

```bash
npm install @baezel/data-module
```

Peer dependencies are `@nestjs/common` and `reflect-metadata`. Install only what you use:

```bash
npm install typeorm pg           # postgres via TypeORM
npm install typeorm mysql2       # mysql via TypeORM
npm install mongodb              # mongodb
npm install @prisma/client prisma
npm install @nestjs/config
```

Missing optional peers throw `DbDependencyError` with code `DRIVER_MISSING` and a driver-specific install hint.

`@nestjs/config`, `@nestjs/core`, `@opentelemetry/api`, `@prisma/client`, `prisma`, `mongodb` and `typeorm` are optional peers.

## Requirements

- Node.js 22.18 or newer. The package is ESM-only with `types` + `default` export conditions; CJS consumers use Node's `require(esm)`. There is no top-level await.
- NestJS 10, 11 or 12 with `experimentalDecorators` and `emitDecoratorMetadata` enabled.
- `dbOptions` is mandatory at registration; a bare connector is rejected before the app bootstraps.

## Entry points

| Import | Exports |
| --- | --- |
| `@baezel/data-module` | `DbModule`, `DbService`, config schemas, typed errors, factories, response helpers, hooks, migration runner |
| `@baezel/data-module/typeorm` | `TypeOrmConnector`, `discoverDecoratedEntities`, `createTypeOrmDataSource` |
| `@baezel/data-module/prisma` | `PrismaConnector`, `PrismaConnectorOptions`, `PrismaLikeClient` |
| `@baezel/data-module/mongo` | `MongoConnector`, `MongoConnectorOptions` |
| `@baezel/data-module/otel` | `OpenTelemetryHooks` (experimental until RC) |

## Config-backed registration

Use `registerAsync` with `@nestjs/config` to build `dbOptions` from `ConfigService`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DbModule } from '@baezel/data-module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dbOptions: {
          driver: 'mysql',
          config: {
            host: config.get('db.host'),
            port: +config.get('db.port'),
            username: config.get('db.user'),
            password: config.get('db.password'),
            database: config.get('db.name'),
          },
          entities: { glob: ['dist/**/*.entity.js'], discoverDecorators: true },
          provisioning: { createIfMissing: true },
        },
      }),
    }),
  ],
})
export class AppModule {}
```

`DbModule.register({ dbOptions })` is the synchronous form. Both forms accept an optional `connector` to override the auto-scaffolded connector:

```ts
DbModule.register({ dbOptions, connector: new MyConnector() });
```

Omitting `dbOptions` throws `DbConfigError` at registration time.

## Connector selection

`dbOptions.orm` defaults from `driver`:

| driver | default orm | connector |
| --- | --- | --- |
| `postgres` / `mysql` | `typeorm` | `TypeOrmConnector` built from mapped `DataSourceOptions` |
| `mongodb` | `mongo` | `MongoConnector` |
| any | `prisma` | `PrismaConnector` using `dbOptions.prisma.client` |

`orm: 'native'` requires a supplied `connector`. `connectorFactory` is no longer supported.

`DbService` is global and injectable:

```ts
constructor(private readonly db: DbService) {}

findUsers() {
  return this.db.getRepository<User>('User').findMany();
}
```

Connectors implement `onModuleInit()` and `onApplicationShutdown()`. Call `app.enableShutdownHooks()` in the consuming app.

## Repository contract

```ts
interface IRepository<T> {
  findMany(options?: FindOptions<T>): Promise<T[]>;
  findOne(id: string | number, options?: RepositoryOptions): Promise<T | null>;
  count(where?: Partial<T>): Promise<number>;
  create(data: Partial<T>): Promise<T>;
  update(id: string | number, data: Partial<T>, options?: RepositoryOptions): Promise<T | null>;
  delete(id: string | number, options?: RepositoryOptions): Promise<boolean>;
  upsert(data: Partial<T>, options: UpsertOptions<T>): Promise<T>;
}
```

`upsert` requires a `conflictTarget`. Mongo IDs are `ObjectId` by default; pass `{ idType: 'string' | 'number' | 'uuid' }` for other `_id` types.

## UUID ids and response redaction

Set `dbOptions.identity.strategy: 'uuid'` to persist a deterministic UUIDv5 in `uuidColumn`. The UUID name is `<table>:<numericId>` using `dbOptions.identity.namespace`; the table is derived from the entity/collection and can be overridden with `uuidTable` on `getRepository()`. Repository responses expose `id` as that UUID and keep the numeric id as a non-enumerable `numericId` for service-layer use; JSON serialization omits it. UUID lookups resolve through the persisted column.

`namespace` and `uuidColumn` are required when `strategy: 'uuid'`; there are no defaults. The namespace is immutable once data exists — changing it changes every UUID. UUID identity is SQL-only and is rejected for `driver: 'mongodb'`.

Add `uuidColumn` to the entity and index it. Backfill runs in Node, in batches, `WHERE uuid IS NULL`; add the unique index only after the backfill completes. Because the numeric id is known only after insert, create and upsert write the UUID in a second statement inside the same repository transaction; connectors without transaction support are rejected.

`dbOptions.redaction.fields` removes fields from repository output only, supports dot paths such as `profile.ssn`, and never mutates persisted inputs. It is not a security control: queries, logs and `where` filters still see the original fields.

## Entity autoload

`entities.glob` loads compiled JavaScript only; TypeScript entity files cannot be loaded with native type stripping because decorators are not erasable. `discoverDecorators: true` reads TypeORM's global metadata storage and requires the `typeorm` peer. Startup logs the resolved entity count and source. SQL drivers fail fast on zero entities; Mongo may have none.

## Database provisioning

`provisioning.createIfMissing` defaults to `true` outside production and `false` in production, unless set explicitly. Postgres connects to a maintenance database (`postgres`, fallback `template1`); MySQL uses `CREATE DATABASE IF NOT EXISTS … utf8mb4`. Creation is logged and emitted through hooks. Mongo only verifies connectivity and logs that databases are created lazily.

## Pooling, timeouts, resilience and safety

`pool`, `timeouts` and `driverOptions` map per driver; Mongo has no `queueLimit`. Shutdown races the driver close against `timeouts.shutdownMs` and then forces it. `resilience` configures cockatiel retries and a per-connector breaker; retries apply only to idempotent operations and transient failures.

Safety flags default to false and hard-fail in production: `allowSchemaSync`, `allowDropSchema`, `allowDropDatabase`, `allowDestructiveMigrations`, `allowInsecureTls`, `exposeDataSource` and `allowSeed`. An `environment` override differing from `NODE_ENV=production` logs a warning and emits a hook event.

## Migration CLI

The `baezel-data` binary dispatches commands from `dbOptions.orm`. Supply a module exporting `dbOptions`. The module is loaded with native TypeScript stripping, so it must use erasable syntax and must not import decorated entities; TypeORM entities load from compiled `dist/**/*.entity.js` globs.

```bash
baezel-data make AddUsers --db-config ./src/db.config.ts
baezel-data up --db-config ./src/db.config.ts
baezel-data down --db-config ./src/db.config.ts
baezel-data status --db-config ./src/db.config.ts
baezel-data status --offline --db-config ./src/db.config.ts
```

| Command | TypeORM | Prisma | Mongo |
| --- | --- | --- | --- |
| `make <name>` | `typeorm migration:create migrations/<name>` | unsupported | unsupported |
| `up` | `typeorm migration:run -d <generated>` | `prisma migrate deploy --schema <path>` | unsupported |
| `down` | `typeorm migration:revert -d <generated>` | unsupported | unsupported |
| `status` | `typeorm migration:show -d <generated>` | `prisma migrate status --schema <path>` | unsupported |

There is no `generate` command. `make` delegates to TypeORM and creates a timestamped `migrations/<epoch-ms>-<name>.ts` skeleton with a class name ending in that timestamp; the exact 13-digit millisecond timestamp is generated by TypeORM. `down` requires `safety.allowDestructiveMigrations` and is hard-blocked in production. The default migration directory is project-root `migrations/` resolved from the current working directory, configurable with `dbOptions.migrations.directory`. The TypeORM tracking table defaults to `migrations`.

TypeORM CLI receives a generated data-source wrapper in a mode-`0700` temporary directory, written as mode `0600`. It reads `dbOptions` from an environment variable; no secret is passed in argv. The wrapper is deleted in `finally`. Only the CLI process installs `SIGINT`/`SIGTERM` handlers: it cleans up, re-raises the signal, and exits with the conventional `128+N` status. The library never installs signal handlers; consumers using the programmatic API own their lifecycle. Prisma receives `DATABASE_URL` through the environment and uses its own schema/migration files; the `prisma` CLI must be installed. `createTypeOrmDataSource(dbOptions)` is exported from `/typeorm` so a `typeorm.config.ts` can export the same DataSource for TypeORM's own CLI:

```ts
import { createTypeOrmDataSource } from '@baezel/data-module/typeorm';

export default createTypeOrmDataSource(dbOptions);
```

## OpenTelemetry

`@baezel/data-module/otel` exports `OpenTelemetryHooks`, which emits spans via the optional `@opentelemetry/api` peer. It stays experimental through the 1.0 betas.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, verification and release steps. There is no CI service; all checks run locally.

## License

MIT
