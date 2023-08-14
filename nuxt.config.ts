import { config } from 'dotenv';
config();
// https://nuxt.com/docs/api/configuration/nuxt-config

export default defineNuxtConfig({
	runtimeConfig: {
		source_bucket: process.env.S3_BUCKET,
	},
	nitro: {
		preset: 'aws-lambda',
	},
});
