import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const outputDirectory = path.resolve('dist-server');

fs.rmSync(outputDirectory, {recursive: true, force: true});

await build({
	entryPoints: {
		index: 'server/index.ts',
		worker: 'server/worker.ts',
		storageInit: 'server/storageInit.ts',
	},
	outdir: outputDirectory,
	bundle: true,
	packages: 'external',
	platform: 'node',
	format: 'esm',
	target: 'node20',
	sourcemap: false,
	logLevel: 'info',
});
