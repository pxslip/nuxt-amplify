// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  nitro: {
    preset: undefined,
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
