/* eslint-env node */

const {readFileSync} = require('fs');
const {join} = require('path');
const {builtinModules} = require('module');
const vue = require('@vitejs/plugin-vue');

const PACKAGE_ROOT = __dirname;
const {chrome} = JSON.parse(readFileSync(join(PACKAGE_ROOT, '../../.electron-vendors.cache.json'), 'utf-8'));

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
const config = {
  mode: process.env.MODE,
  root: PACKAGE_ROOT,
  resolve: {
    alias: {
      '/@/': join(PACKAGE_ROOT, 'src') + '/',
    },
  },
  plugins: [typeof vue === 'function' ? vue() : vue.default()],
  base: '',
  server: {
    fs: {
      strict: true,
    },
  },
  build: {
    sourcemap: true,
    target: `chrome${chrome}`,
    outDir: 'dist',
    assetsDir: '.',
    rollupOptions: {
      external: [
        ...builtinModules,
      ],
    },
    emptyOutDir: true,
    brotliSize: false,
  },
};

module.exports = config;
