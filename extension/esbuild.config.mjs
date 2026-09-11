import { build, context } from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');

async function run() {
  if (!existsSync('dist')) mkdirSync('dist');
  cpSync('public', 'dist', { recursive: true });

  const options = {
    entryPoints: ['src/background.ts', 'src/popup.ts'],
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    target: 'chrome120',
    sourcemap: true,
    logLevel: 'info',
  };

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('Watching for changes... (recordá "npm run build" copia public/ solo una vez; volvé a correrlo si tocás manifest.json o popup.html)');
  } else {
    await build(options);
    console.log('Build listo -> dist/ (cargar como extensión sin empaquetar en chrome://extensions)');
  }
}

run();
