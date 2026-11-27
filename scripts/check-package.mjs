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
import { join } from 'node:path';
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

function withPackedPackage(run) {
  const temporary = mkdtempSync(join(root, '.verify-'));
  try {
    const output = execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const [artifact] = JSON.parse(output);
    execFileSync('tar', ['-xzf', join(temporary, artifact.filename), '-C', temporary], { stdio: 'inherit' });
    return run(join(temporary, 'package'), temporary);
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

function smokeCjs(packageDirectory, temporary) {
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
}

if (mode === 'no-tla' || mode === 'all') {
  checkNoTla();
}

if (mode === 'guard' || mode === 'all') {
  withPackedPackage(checkGuard);
}

if (mode === 'smoke' || mode === 'all') {
  withPackedPackage(smokeCjs);
}

if (!['no-tla', 'guard', 'smoke', 'all'].includes(mode)) {
  fail(`unknown mode: ${mode}`);
}
