'use strict';

const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

esbuild.buildSync({
  entryPoints: [path.join(root, 'src/js/util/highlight-engine.js')],
  outfile: path.join(root, 'src/js/util/highlight-engine.bundle.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  logLevel: 'warning',
});

console.log('[build] Highlight.js local bundle ready');
