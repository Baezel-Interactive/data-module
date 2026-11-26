const [major = 0, minor = 0, patch = 0] = process.versions.node
  .split('.')
  .map((part) => Number.parseInt(part, 10) || 0);

const isSupported = major > 22 || (major === 22 && minor > 18) || (major === 22 && minor === 18 && patch >= 0);

if (!isSupported) {
  throw new Error(
    `@baezel/data-module requires Node.js 22.18.0 or newer (found ${process.versions.node}). ` +
      'CommonJS consumers on Node older than 22.12 fail with ERR_REQUIRE_ESM before this check runs.',
  );
}
