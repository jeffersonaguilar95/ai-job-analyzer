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
    console.log('Watching for changes... (this only copies public/ once; re-run "yarn build" if you touch manifest.json or popup.html)');
  } else {
    await build(options);
    console.log('Build ready -> dist/ (load as an unpacked extension in chrome://extensions)');
  }
}

run();
