import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  DB_CONNECTOR,
  DbConfigError,
  DbModule,
  DbService,
  normalizeRegistration,
  resolveConnector,
  type IDbConnector,
  type IRepository,
} from '../src/index.js';

const connector: IDbConnector = {
  getRepository: <T>(): IRepository<T> => ({
    findMany: async () => [] as T[],
    findOne: async () => null,
    count: async () => 0,
    create: async (data) => data as T,
    update: async () => null,
    delete: async () => false,
    upsert: async (data) => data as T,
  }),
};

const dbOptions = {
  driver: 'postgres' as const,
  config: { host: 'localhost', database: 'app' },
  provisioning: { createIfMissing: false },
};

describe('dbOptions registration', () => {
  it('normalizes a dbOptions registration with a connector override', () => {
    const registration = normalizeRegistration({ dbOptions, connector });
    expect(registration.connector).toBe(connector);
    expect(registration.dbOptions.driver).toBe('postgres');
  });

  it('rejects a bare connector without dbOptions', () => {
    expect(() => normalizeRegistration({ connector })).toThrow(DbConfigError);
  });

  it('rejects undefined, null and empty dbOptions with actionable errors', () => {
    for (const input of [
      { connector },
      { dbOptions: undefined, connector },
      { dbOptions: null, connector },
      { dbOptions: {} },
    ]) {
      expect(() => normalizeRegistration(input)).toThrow(DbConfigError);
    }

    try {
      normalizeRegistration({ dbOptions: {} });
    } catch (error) {
      expect(String(error)).toMatch(/driver|dbOptions/i);
      expect(String(error)).not.toContain('undefined');
    }
  });

  it('rejects removed runtime shapes', () => {
    expect(() =>
      normalizeRegistration({ kind: 'driver', driver: 'postgres', config: {}, connectorFactory: () => connector }),
    ).toThrow(DbConfigError);
    expect(() => normalizeRegistration({ driver: 'postgres', config: {} })).toThrow(DbConfigError);
    expect(() => normalizeRegistration({ connectorFactory: () => connector })).toThrow(DbConfigError);
  });

  it('validates config and supplies a context to the factory', async () => {
    const factory = vi.fn(
      (context: { driver: string; safety: { allowSchemaSync: boolean }; environment: string }) => {
        expect(context.driver).toBe('postgres');
        expect(context.safety.allowSchemaSync).toBe(false);
        expect(context.environment).toBe('development');
        return connector;
      },
    );

    const registration = normalizeRegistration({ dbOptions, connector });
    expect(factory).not.toHaveBeenCalled();
    expect(await resolveConnector(registration)).toBe(connector);
  });

  it('rejects invalid drivers and does not leak secrets from config errors', () => {
    const secret = 'config-secret';
    expect(() =>
      normalizeRegistration({
        dbOptions: {
          driver: 'oracle' as never,
          config: `postgres://user:${secret}@host/db`,
        },
      }),
    ).toThrow(DbConfigError);

    try {
      normalizeRegistration({
        dbOptions: {
          driver: 'oracle' as never,
          config: `postgres://user:${secret}@host/db`,
        },
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('requires namespace and uuidColumn for UUID identity', () => {
    expect(() =>
      normalizeRegistration({
        dbOptions: { driver: 'postgres', config: {}, identity: { strategy: 'uuid' } },
      }),
    ).toThrow(DbConfigError);
    expect(() =>
      normalizeRegistration({
        dbOptions: {
          driver: 'postgres',
          config: {},
          identity: { strategy: 'uuid', namespace: '6ba7b811-9dad-11d1-80b4-00c04fd430c8' },
        },
      }),
    ).toThrow(DbConfigError);
  });

  it('rejects UUID identity for MongoDB', () => {
    expect(() =>
      normalizeRegistration({
        dbOptions: {
          driver: 'mongodb',
          config: { url: 'mongodb://localhost/app' },
          identity: {
            strategy: 'uuid',
            uuidColumn: 'uuid',
            namespace: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
          },
        },
      }),
    ).toThrow(DbConfigError);
  });

  it('register() supports dbOptions with a connector override', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule.register({ dbOptions, connector })],
    }).compile();

    expect(moduleRef.get(DB_CONNECTOR)).toBe(connector);
    expect(moduleRef.get(DbService).getConnector()).toBe(connector);
  });

  it('registerAsync() supports ConfigService-backed dbOptions', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ db: { host: 'localhost', name: 'app' } })],
        }),
        DbModule.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            dbOptions: {
              driver: 'postgres',
              config: { host: config.get<string>('db.host'), database: config.get<string>('db.name') },
              provisioning: { createIfMissing: false },
            },
            connector,
          }),
        }),
      ],
    }).compile();

    expect(moduleRef.get(DB_CONNECTOR)).toBe(connector);
  });
});
