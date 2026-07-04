const esbuild = require('esbuild');

// ws/qrcode/agent-sdk stay external: vsce ships production node_modules, and the
// agent SDK spawns its own bundled CLI file, so it cannot be inlined anyway.
esbuild
  .build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    external: ['vscode', '@anthropic-ai/claude-agent-sdk', 'ws', 'qrcode'],
    logLevel: 'info',
  })
  .catch(() => process.exit(1));
