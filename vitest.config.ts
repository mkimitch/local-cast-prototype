import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		clearMocks: true,
		fileParallelism: false,
		restoreMocks: true,
		testTimeout: 10_000,
	},
});
