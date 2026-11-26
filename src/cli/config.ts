import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { DbConfigError } from '../errors/index.js';

export const cliConfigSchema = z.object({
  driver: z.enum(['postgres', 'mysql', 'mongodb']).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  migrations: z.array(z.string()).default([]),
  seeds: z.array(z.string()).default([]),
  environment: z.enum(['production', 'development', 'test']).optional(),
  safety: z.record(z.string(), z.unknown()).default({}),
});

export type CliConfig = z.infer<typeof cliConfigSchema>;

export async function loadCliConfig(explicitPath?: string): Promise<CliConfig> {
  const file = path.resolve(process.cwd(), explicitPath ?? 'baezel-data.config.ts');
  try {
    const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
    return cliConfigSchema.parse(module.default ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new DbConfigError('Invalid baezel-data CLI configuration', { details: { issues: error.issues } });
    }
    throw new DbConfigError(`Could not load CLI config ${file}`, { details: { cause: String(error) } });
  }
}
