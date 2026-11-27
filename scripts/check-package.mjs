import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2] ?? 'all';
const root = process.cwd();
const entries = [
  'dist/index.js',
  'dist/prisma/index.js',
  'dist/typeorm/index.js',
  'dist/mongo/index.js',
  'dist/otel/index.js',
];

function fail(message) {
  console.error(`check-package: ${message}`);
  process.exitCode = 1;
}

function javascriptFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...javascriptFiles(path));
    } else if (entry.name.endsWith('.js')) {
      found.push(path);
    }
  }
  return found;
}

function checkNoTla() {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) {
    fail('dist/ does not exist; run npm run build first');
    return;
  }

  for (const file of javascriptFiles(dist)) {
    const source = readFileSync(file, 'utf8');
    if (/^(?:await|for\s+await)\b/m.test(source)) {
      fail(`top-level await found in ${file.slice(root.length + 1)}`);
    }
  }
}

const FORBIDDEN_ROOT_PEERS = new Set([
  '@nestjs/config',
  '@opentelemetry/api',
  '@prisma/client',
  'mongodb',
  'prisma',
  'typeorm',
]);

function staticSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:from\s+|import\s*)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function checkRootPeerImports() {
  const entry = join(root, 'dist', 'index.js');
  if (!existsSync(entry)) {
    fail('dist/index.js does not exist; run npm run build first');
    return;
  }

  const visited = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const specifier of staticSpecifiers(source)) {
      if (FORBIDDEN_ROOT_PEERS.has(specifier)) {
        fail(`root entry graph imports forbidden peer ${specifier} via ${file.slice(root.length + 1)}`);
        continue;
      }
      if (specifier.startsWith('.')) {
        const resolved = resolve(join(file, '..'), specifier);
        if (existsSync(resolved)) {
          queue.push(resolved);
        }
      }
    }
  }
}

function withPackedPackage(run) {
  const temporary = mkdtempSync(join(root, '.verify-'));
  try {
    const output = execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const [artifact] = JSON.parse(output);
    const tarball = join(temporary, artifact.filename);
    execFileSync('tar', ['-xzf', tarball, '-C', temporary], { stdio: 'inherit' });
    return run(join(temporary, 'package'), temporary, tarball);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function checkGuard(packageDirectory) {
  const guard = join(packageDirectory, 'dist', 'runtime', 'node-guard.js');
  if (!existsSync(guard)) {
    fail('packed tarball is missing dist/runtime/node-guard.js');
  }

  for (const entry of entries) {
    const source = readFileSync(join(packageDirectory, entry), 'utf8');
    if (!source.includes('runtime/node-guard.js')) {
      fail(`${entry} does not import the node guard`);
    }
  }
}

function smokeCjs(packageDirectory, temporary, tarball) {
  const project = join(temporary, 'project');
  const scope = join(project, 'node_modules', '@baezel');
  mkdirSync(scope, { recursive: true });
  symlinkSync(packageDirectory, join(scope, 'data-module'), 'dir');
  const binDirectory = join(project, 'node_modules', '.bin');
  mkdirSync(binDirectory, { recursive: true });
  const binPath = join(binDirectory, 'baezel-data');
  symlinkSync(join(packageDirectory, 'dist', 'cli', 'index.js'), binPath);
  writeFileSync(join(project, 'index.cjs'), '');

  mkdirSync(join(temporary, 'migrations'), { recursive: true });
  writeFileSync(join(temporary, 'migrations', '001_init.js'), 'export async function up() {}\n');
  writeFileSync(
    join(temporary, 'baezel-db-config.js'),
    "export const dbOptions = { driver: 'postgres', config: { host: 'localhost', database: 'app' }, provisioning: { createIfMissing: false }, migrations: { directory: 'migrations' } };\n",
  );

  const cliOutput = execFileSync(
    process.execPath,
    [binPath, 'status', '--offline', '--db-config', './baezel-db-config.js'],
    {
      cwd: temporary,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  if (!cliOutput.includes('001_init.js')) {
    fail(`CLI status did not list the fixture migration: ${cliOutput.trim()}`);
  }

  const requireFromProject = createRequire(pathToFileURL(join(project, 'index.cjs')));
  for (const id of [
    '@baezel/data-module',
    '@baezel/data-module/typeorm',
    '@baezel/data-module/prisma',
    '@baezel/data-module/mongo',
    '@baezel/data-module/otel',
  ]) {
    try {
      const loaded = requireFromProject(id);
      if (!loaded || typeof loaded !== 'object') {
        fail(`${id} did not return a module namespace`);
      }
    } catch (error) {
      fail(`require(${id}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const cjsAppPath = join(project, 'cjs-nest.cjs');
  writeFileSync(
    cjsAppPath,
    [
      "require('reflect-metadata');",
      "const { Test } = require('@nestjs/testing');",
      "const { DB_CONNECTOR, DbModule, DbProvisioningError, DbService } = require('@baezel/data-module');",
      'const connector = { getRepository: () => ({ findMany: async () => [], findOne: async () => null, count: async () => 0, create: async (data) => data, update: async () => null, delete: async () => false, upsert: async (data) => data }) };',
      '(async () => {',
      '  const valid = await Test.createTestingModule({ imports: [DbModule.register({ dbOptions: { driver: "postgres", config: { host: "localhost", database: "app" }, provisioning: { createIfMissing: false } }, connector })] }).compile();',
      '  if (valid.get(DbService).getConnector() !== connector || valid.get(DB_CONNECTOR) !== connector) throw new Error("CJS Nest app did not resolve connector");',
      '  try {',
      '    await Test.createTestingModule({ imports: [DbModule.registerAsync({ useFactory: () => { throw new DbProvisioningError("cjs boot failed", { code: "CJS_TEST" }); } })] }).compile();',
      '    throw new Error("expected provisioning failure");',
      '  } catch (error) {',
      '    if (!(error instanceof DbProvisioningError) || error.name !== "DbProvisioningError" || error.code !== "CJS_TEST") {',
      '      throw new Error("Provisioning error identity lost across require(esm)");',
      '    }',
      '  }',
      "  console.log('cjs-nest-ok');",
      '})().catch((error) => { console.error(error); process.exit(1); });',
      '',
    ].join('\n'),
  );
  const cjsOutput = execFileSync(process.execPath, [cjsAppPath], {
    cwd: project,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (!cjsOutput.includes('cjs-nest-ok')) {
    fail('packed CJS Nest app smoke failed');
  }

  const peerless = mkdtempSync(join(temporary, 'peerless-'));
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      peerless,
      '--no-save',
      '--no-audit',
      '--no-fund',
      tarball,
      '@nestjs/common@12',
      'reflect-metadata',
      'rxjs',
    ],
    { cwd: temporary, stdio: 'inherit' },
  );
  writeFileSync(join(peerless, 'index.mjs'), "import '@baezel/data-module';\nconsole.log('peerless-root-ok');\n");
  const peerlessOutput = execFileSync(process.execPath, [join(peerless, 'index.mjs')], {
    cwd: peerless,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (!peerlessOutput.includes('peerless-root-ok')) {
    fail('root entry failed to load with only required peers installed');
  }
}

if (mode === 'no-tla' || mode === 'all') {
  checkNoTla();
}

if (mode === 'root-peers' || mode === 'all') {
  checkRootPeerImports();
}

if (mode === 'guard' || mode === 'all') {
  withPackedPackage(checkGuard);
}

if (mode === 'smoke' || mode === 'all') {
  withPackedPackage(smokeCjs);
}

if (!['no-tla', 'root-peers', 'guard', 'smoke', 'all'].includes(mode)) {
  fail(`unknown mode: ${mode}`);
}
