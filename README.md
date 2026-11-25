# @baezel/data-module

Pluggable NestJS database module with a driver-agnostic connector contract. The core package has no ORM dependency; use the optional `/prisma` or `/typeorm` subpaths for the connector you need.

[![npm version](https://img.shields.io/npm/v/@baezel/data-module)](https://www.npmjs.com/package/@baezel/data-module)
[![license](https://img.shields.io/npm/l/@baezel/data-module)](https://www.npmjs.com/package/@baezel/data-module)

**Links:** [npm](https://www.npmjs.com/package/@baezel/data-module) · [Repository](https://github.com/Baezel-Interactive/data-module) · [Issues](https://github.com/Baezel-Interactive/data-module/issues) · [Contributing](CONTRIBUTING.md)

## Install

```bash
npm install @baezel/data-module
```

Peer dependencies: `@nestjs/common` and `reflect-metadata`. Install `typeorm` only if you use the `/typeorm` subpath:

```bash
npm install @baezel/data-module typeorm
```

For Prisma, you provide your own generated client, so this package installs no Prisma packages for you.

## Requirements

- NestJS 10, 11 or 12, with `reflect-metadata` loaded once at application startup.
- TypeScript with `experimentalDecorators` and `emitDecoratorMetadata` enabled.
- The published build is CommonJS with type declarations; the `exports` map provides `require` and `default` conditions only, with no separate ESM `import` condition. ESM consumers can use standard Node interop.

## Entry points

| Import | Exports |
| --- | --- |
| `@baezel/data-module` | `DbModule`, `DbService`, `DB_CONNECTOR`, `DB_MODULE_OPTIONS`, `IDbConnector`, `IRepository`, `DbEntity`, `DbModuleOptions`, `DbModuleAsyncOptions`, `DbConnectorFactory` |
| `@baezel/data-module/prisma` | `PrismaConnector`, `PrismaConnectorOptions`, `PrismaLikeClient` |
| `@baezel/data-module/typeorm` | `TypeOrmConnector` |

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

Connectors supplied to `register()` or returned from `registerAsync()` receive the Nest `onModuleInit()` and `onModuleDestroy()` lifecycle hooks during application bootstrap and shutdown.

The connector contract is deliberately small:

```ts
interface IRepository<T> {
  findMany(): Promise<T[]>;
  findOne(id: number): Promise<T | null>;
}

interface IDbConnector {
  getRepository<T>(entity: string | (new () => T)): IRepository<T>;
}
```

For custom backends implement `IDbConnector` and pass it to `DbModule.register({ connector })`.

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

## Contributing

Bug reports, feature requests and pull requests are welcome via the [issue tracker](https://github.com/Baezel-Interactive/data-module/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and workflow details.

## Development

```bash
npm install
npm run build      # tsc -> dist/ (CommonJS with .d.ts)
npm test           # Jest (Node --experimental-vm-modules for Nest 12 ESM)
npm run lint
npm pack --dry-run # verify published file list
```

## Publishing (maintainer)

Ensure the `@baezel` npm scope exists and you are logged in with publish rights (`npm whoami`). `publishConfig.access` is set to `public`, so a scoped release needs no extra flag. `prepublishOnly` runs lint and tests, and `prepack` rebuilds `dist`.

Use `npm version <patch|minor|major>` to bump the version and create the matching git tag, then run `npm publish`. The publishing account enforces two-factor authentication for writes, so have an authenticator ready for the OTP prompt. After publishing, verify with `npm view @baezel/data-module` and push the tag with `git push --follow-tags`.

## License

MIT
