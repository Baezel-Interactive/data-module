import { getMetadataArgsStorage } from 'typeorm';
import type { EntityClass } from '../entities/glob.js';

export function discoverDecoratedEntities(): EntityClass[] {
  const targets = new Set<EntityClass>();
  for (const table of getMetadataArgsStorage().tables) {
    if (typeof table.target === 'function' && table.target.prototype !== undefined) {
      targets.add(table.target as EntityClass);
    }
  }
  return [...targets];
}
