import type { ConnectorFactoryContext, ResolvedEntities } from '../config/index.js';
import { DbConfigError } from '../errors/index.js';
import { loadEntitiesFromGlob, type EntityClass } from './glob.js';

export async function resolveEntities(context: ConnectorFactoryContext): Promise<ResolvedEntities | undefined> {
  const { glob, discoverDecorators } = context.entities;
  if (glob.length === 0 && !discoverDecorators) {
    return undefined;
  }

  const targets = new Set<EntityClass>();
  let files = 0;
  let globCount = 0;
  let decoratorCount = 0;

  if (glob.length > 0) {
    const loaded = await loadEntitiesFromGlob(glob);
    files = loaded.files;
    globCount = loaded.targets.length;
    for (const target of loaded.targets) {
      targets.add(target);
    }
  }

  if (discoverDecorators) {
    let discover: typeof import('../typeorm/entities.js').discoverDecoratedEntities;
    try {
      ({ discoverDecoratedEntities: discover } = await import('../typeorm/entities.js'));
    } catch (error) {
      throw new DbConfigError('Decorator entity discovery requires the optional typeorm peer', {
        details: { cause: String(error) },
      });
    }
    const decorated = discover();
    decoratorCount = decorated.length;
    for (const target of decorated) {
      targets.add(target);
    }
  }

  if (context.driver !== 'mongodb' && targets.size === 0) {
    throw new DbConfigError('No entities were found for a SQL driver', {
      details: { glob, discoverDecorators },
    });
  }

  context.logger.log(
    `Resolved ${targets.size} entities from ${files} file(s) (${globCount} glob, ${decoratorCount} decorator).`,
  );

  return {
    targets: [...targets],
    sources: { glob: globCount, decorators: decoratorCount, files },
  };
}
