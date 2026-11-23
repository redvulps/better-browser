import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist/extension', { recursive: true });
await cp('extension', 'dist/extension', { recursive: true });
await build({
  entryPoints: ['src/extension/worker.ts', 'src/extension/popup.ts'],
  outdir: 'dist/extension', platform: 'browser', target: 'chrome116', bundle: true, format: 'esm'
});
await build({
  entryPoints: { mcp: 'src/agent/mcp.ts', bridge: 'src/bridge/server.ts', pair: 'src/agent/pair.ts' },
  outdir: 'dist', platform: 'node', target: 'node22', packages: 'external', bundle: true, format: 'esm'
});
