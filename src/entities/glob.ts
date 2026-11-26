import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DbConfigError } from '../errors/index.js';

export type EntityClass = new () => unknown;

export interface GlobEntityResult {
  targets: EntityClass[];
  files: number;
}

export interface LoadedModule {
  file: string;
  exports: Record<string, unknown>;
}

const WILDCARD = /[*?]/;

function escapeRegExp(character: string): string {
  return /[\\^$.+()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  for (let index = 0; index < glob.length; index += 1) {
    if (glob.slice(index, index + 3) === '**/') {
      pattern += '(?:.*/)?';
      index += 2;
      continue;
    }
    const character = glob[index];
    if (character === '*') {
      pattern += '[^/]*';
    } else if (character === '?') {
      pattern += '[^/]';
    } else {
      pattern += escapeRegExp(character);
    }
  }
  return new RegExp(`${pattern}$`);
}

function baseDirectory(glob: string): string {
  const wildcard = glob.search(WILDCARD);
  if (wildcard === -1) {
    return path.dirname(glob);
  }
  const slash = glob.lastIndexOf('/', wildcard);
  return slash === -1 ? '.' : glob.slice(0, slash) || '.';
}

function matchingFiles(directory: string, matcher: RegExp, root: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...matchingFiles(fullPath, matcher, root));
    } else if (entry.isFile()) {
      const relative = path.relative(root, fullPath).split(path.sep).join('/');
      if (matcher.test(relative)) {
        found.push(fullPath);
      }
    }
  }
  return found;
}

function isEntityClass(value: unknown): value is EntityClass {
  return typeof value === 'function' && value.prototype !== undefined && value.name.length > 0;
}

export async function loadModulesFromGlob(patterns: string[], allowTypeScript = false): Promise<LoadedModule[]> {
  const root = process.cwd();
  const files = new Set<string>();

  for (const rawPattern of patterns) {
    if (!allowTypeScript && rawPattern.includes('.ts')) {
      throw new DbConfigError('Entity glob patterns must point to compiled JavaScript, not TypeScript', {
        details: { pattern: rawPattern },
      });
    }

    const pattern = rawPattern.replace(/\\/g, '/').replace(/^\.\//, '');
    const searchRoot = path.resolve(root, baseDirectory(pattern));
    for (const file of matchingFiles(searchRoot, globToRegExp(pattern), root)) {
      files.add(file);
    }
  }

  const loaded: LoadedModule[] = [];
  for (const file of [...files].sort()) {
    loaded.push({ file, exports: (await import(pathToFileURL(file).href)) as Record<string, unknown> });
  }
  return loaded;
}

export async function loadEntitiesFromGlob(patterns: string[]): Promise<GlobEntityResult> {
  const modules = await loadModulesFromGlob(patterns, false);
  const targets = new Set<EntityClass>();

  for (const loaded of modules) {
    for (const value of Object.values(loaded.exports)) {
      if (isEntityClass(value)) {
        targets.add(value);
      }
    }
  }

  return { targets: [...targets], files: modules.length };
}
