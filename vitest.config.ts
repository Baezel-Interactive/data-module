import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

const swcPlugin = swc.vite({
  jsc: {
    parser: { syntax: 'typescript', decorators: true, dynamicImport: true },
    transform: { decoratorMetadata: true, legacyDecorator: true },
    target: 'es2022',
  },
});

export default defineConfig({
  plugins: [swcPlugin],
  test: {
    include: ['test/**/*.ts'],
    exclude: ['test/**/*.test-d.ts'],
    typecheck: {
      enabled: false,
      include: ['test/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
  },
});
