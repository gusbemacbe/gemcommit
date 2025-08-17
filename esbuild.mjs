// esbuild.mjs
import { build } from 'esbuild';

// Check if the --watch flag is present
const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'], // 'vscode' is a runtime-provided module and must be external
  mainFields: ['browser', 'module', 'main'], // Look for browser-specific code first
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  logLevel: 'info',
};

async function main() {
  if (isWatch) {
    // Development watch mode
    const context = await build({
      ...buildOptions,
      minify: false, // Don't minify in watch mode for easier debugging
    });
    await context.watch();
    console.log('Watching for changes...');
  } else {
    // Production build
    await build({
      ...buildOptions,
      minify: true,
    });
    console.log('Build complete.');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
