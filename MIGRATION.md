# Migration guide

## 0.x → 1.0.0

`@baezel/data-module@1.0.0` is a breaking release. The key change is that configuration is now passed through `dbOptions`; a connector is no longer the primary registration input.

### Registration

Before:

```ts
DbModule.register({ connector: new TypeOrmConnector(options) });
```

After:

```ts
DbModule.register({
  dbOptions: {
    driver: 'postgres',
    config: options,
  },
});
```

`DbModule.registerAsync` works the same way and is designed for `@nestjs/config`:

```ts
DbModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    dbOptions: {
      driver: 'mysql',
      config: {
        host: config.get('db.host'),
        port: +config.get('db.port'),
        database: config.get('db.name'),
      },
    },
  }),
});
```

### Removed

- Bare `DbModule.register({ connector })`.
- `kind: 'driver'` registration.
- `connectorFactory`.
- The file-based `baezel-data.config.ts` CLI config and the old `baezel-data migrate/status/seed` command set.
- The custom raw-SQL migration runner and `generate` command.

### Connector override

`connector` is still supported, but only as an override alongside `dbOptions`:

```ts
DbModule.register({ dbOptions, connector: new MyConnector() });
```

### Migrations

Use the restored `baezel-data` CLI with a module that exports `dbOptions`:

```bash
baezel-data make AddUsers --db-config ./src/db.config.ts
baezel-data up --db-config ./src/db.config.ts
baezel-data down --db-config ./src/db.config.ts
baezel-data status --db-config ./src/db.config.ts
```

TypeORM uses `typeorm migration:*`; Prisma uses `prisma migrate deploy/status`; Mongo migrations are unsupported. The default migration directory is project-root `migrations/`, not `src/migrations/`.

For TypeORM CLI compatibility, export the DataSource created by the package:

```ts
import { createTypeOrmDataSource } from '@baezel/data-module/typeorm';

export default createTypeOrmDataSource(dbOptions);
```

### UUID and redaction

`identity.strategy: 'uuid'` is opt-in. Add a `uuidColumn` to the entity, index it and backfill existing rows. UUIDv5 is derived from `<table>:<numericId>` using the configured namespace; the table is derived from the entity/collection or overridden with `uuidTable`. On insert, the UUID is written in a second statement inside the same repository transaction. Repository responses expose UUID `id` and keep the numeric id as non-enumerable `numericId`.

Redaction is output-only and is not a security control: queries, logs and `where` filters still see the original fields.
