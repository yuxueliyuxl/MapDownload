const {readFileSync} = require('fs');
const {join} = require('path');
const {builtinModules} = require('module');

const PACKAGE_ROOT = __dirname;
const {node} = JSON.parse(readFileSync(join(PACKAGE_ROOT, '../../.electron-vendors.cache.json'), 'utf-8'));

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
const config = {
  mode: process.env.MODE,
  root: PACKAGE_ROOT,
  envDir: process.cwd(),
  resolve: {
    alias: {
      '/@/': join(PACKAGE_ROOT, 'src') + '/',
    },
  },
  build: {
    sourcemap: 'inline',
    target: `node${node}`,
    outDir: 'dist',
    assetsDir: '.',
    minify: process.env.MODE !== 'development',
    lib: {
      entry: 'src/index.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [
        'electron',
        'electron-devtools-installer',
        ...builtinModules,
      ],
      output: {
        entryFileNames: '[name].cjs',
      },
    },
    emptyOutDir: true,
    brotliSize: false,
  },
};

module.exports = config;
