import { join, resolve } from 'path';
// https://nuxt.com/docs/api/configuration/nuxt-config
const outputDir = resolve('./.output');
const standaloneDir = join(outputDir, 'standalone');
export default defineNuxtConfig({
  nitro: {
    preset: undefined,
    output: {
      dir: outputDir,
      serverDir: standaloneDir,
      publicDir: standaloneDir,
    },
  },
  vite: {
    define: {
      'window.global': {},
    },
    resolve: {
      alias: [
        {
          find: './runtimeConfig',
          replacement: './runtimeConfig.browser',
        },
      ],
    },
  },
});
