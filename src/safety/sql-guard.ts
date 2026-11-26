import type { ConnectorFactoryContext } from '../config/index.js';
import { assertDestructiveOperation } from './policy.js';

const DESTRUCTIVE = /\b(?:DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE[\s\S]*?\bDROP)\b/i;

function withoutCommentsAndStrings(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:[^"])*"/g, '""');
}

export function isDestructiveSql(sql: string): boolean {
  return DESTRUCTIVE.test(withoutCommentsAndStrings(sql));
}

export function guardDestructiveSql(
  sql: string,
  context: ConnectorFactoryContext,
  options: { override?: boolean } = {},
): void {
  if (isDestructiveSql(sql)) {
    assertDestructiveOperation(context, 'destructiveMigration', options);
  }
}

export interface QueryRunnerLike {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

export function wrapQueryRunner<T extends QueryRunnerLike>(
  runner: T,
  context: ConnectorFactoryContext,
  options: { override?: boolean } = {},
): T {
  return new Proxy(runner, {
    get(target, property, receiver) {
      if (property === 'query') {
        return async (sql: string, parameters?: unknown[]) => {
          guardDestructiveSql(sql, context, options);
          return target.query(sql, parameters);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
