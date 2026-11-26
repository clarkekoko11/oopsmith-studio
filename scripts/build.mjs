// Builds the three parts of the app into dist/:
//   main.mjs     Electron main process (ESM, Node) — agents, settings, files
//   preload.cjs  bridge between the window and main (CommonJS, required by Electron's sandbox)
//   renderer/    the 3D office + UI (browser bundle)
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist/renderer', { recursive: true });

await Promise.all([
  build({
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron', '@anthropic-ai/claude-agent-sdk', 'electron-updater'],
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    sourcemap: true,
  }),
  build({
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    entryPoints: ['src/renderer/main.ts'],
    outfile: 'dist/renderer/app.js',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome130',
    sourcemap: true,
  }),
]);

cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
cpSync('src/renderer/assets', 'dist/renderer/assets', { recursive: true });
console.log('built dist/');
if (watch) console.log('(watch mode not implemented; re-run npm run build)');
