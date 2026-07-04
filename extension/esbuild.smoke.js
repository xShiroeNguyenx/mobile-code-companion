// Bundles the standalone smoke test (see src/smoke.entry.ts).
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['src/smoke.entry.ts'],
    bundle: true,
    outfile: 'dist-smoke/smoke.cjs',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode', 'ws'],
    logLevel: 'info',
  })
  .catch(() => process.exit(1));
