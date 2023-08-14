// .eslintrc.js
module.exports = {
	env: {
		browser: true,
		es2021: true,
		node: true,
	},
	extends: [
		'plugin:@typescript-eslint/recommended',
		'plugin:nuxt/recommended',
		'plugin:vue/vue3-recommended',
		'prettier',
	],
	parserOptions: {
		ecmaVersion: 'latest',
		parser: '@typescript-eslint/parser',
		sourceType: 'module',
	},
	plugins: ['@typescript-eslint'],
	ignorePatterns: ['getContentfulEnvironment.js', 'ushmm-contentful/apps'],
	rules: {
		'vue/multi-word-component-names': 'off',
	},
};
