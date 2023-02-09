import { config } from 'dotenv';
config();
// https://nuxt.com/docs/api/configuration/nuxt-config

export default defineNuxtConfig({
  runtimeConfig: {
    bucket: process.env.S3_BUCKET,
    bucketPathPrefix: 'main',
  },
  nitro: {
    preset: 'aws-lambda',
    entry: 'handler.ts',
  },
});
