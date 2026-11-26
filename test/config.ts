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

describe('BYOC registration', () => {
  it('normalizes a plain connector registration', () => {
    const registration = normalizeRegistration({ connector });
    expect(registration.kind).toBe('connector');
  });

  it('validates config and supplies a redacted context to the factory', async () => {
    const factory = vi.fn(
      (context: { driver: string; safety: { allowSchemaSync: boolean }; environment: string }) => {
        expect(context.driver).toBe('postgres');
        expect(context.safety.allowSchemaSync).toBe(false);
        expect(context.environment).toBe('development');
        return connector;
      },
    );

    const registration = normalizeRegistration({
      kind: 'driver',
      driver: 'postgres',
      config: { host: 'localhost', database: 'app' },
      connectorFactory: factory,
      environment: 'development',
      provisioning: { createIfMissing: false },
    });

    expect(registration.kind).toBe('driver');
    expect(await resolveConnector(registration)).toBe(connector);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('rejects invalid drivers and does not leak secrets from config errors', () => {
    const secret = 'config-secret';
    expect(() =>
      normalizeRegistration({
        kind: 'driver',
        driver: 'oracle',
        config: `postgres://user:${secret}@host/db`,
        connectorFactory: () => connector,
      }),
    ).toThrow(DbConfigError);

    try {
      normalizeRegistration({
        kind: 'driver',
        driver: 'oracle',
        config: `postgres://user:${secret}@host/db`,
        connectorFactory: () => connector,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('register() supports a driver registration', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DbModule.register({
          kind: 'driver',
          driver: 'postgres',
          config: { host: 'localhost', database: 'app' },
          connectorFactory: () => connector,
          provisioning: { createIfMissing: false },
        }),
      ],
    }).compile();

    expect(moduleRef.get(DB_CONNECTOR)).toBe(connector);
    expect(moduleRef.get(DbService).getConnector()).toBe(connector);
  });

  it('registerAsync() supports a driver registration', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DbModule.registerAsync({
          useFactory: () => ({
            kind: 'driver' as const,
            driver: 'mongodb' as const,
            config: { url: 'mongodb://localhost', database: 'app' },
            connectorFactory: () => connector,
            provisioning: { createIfMissing: false },
          }),
        }),
      ],
    }).compile();

    expect(moduleRef.get(DB_CONNECTOR)).toBe(connector);
  });
});
