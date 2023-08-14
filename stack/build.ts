import { BuildOptions, build } from 'esbuild';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const stackDir = dirname(fileURLToPath(new URL(import.meta.url)));

const buildOptions: BuildOptions = {
	entryPoints: [fileURLToPath(new URL('./origin-request-handler/index.ts', import.meta.url))],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outdir: join(stackDir, 'dist'),
	outbase: stackDir,
	outExtension: { '.js': '.mjs' },
	mainFields: ['module', 'main'],
};

await build(buildOptions);

export default buildOptions;
