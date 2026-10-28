import {defineConfig, devices} from '@playwright/test';

const port = 43179;

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false,
	retries: 0,
	reporter: 'line',
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		trace: 'retain-on-failure',
		...devices['Desktop Chrome'],
	},
	webServer: [
		{
			command: 'npm run e2e:server',
			url: `http://127.0.0.1:${port}/api/health`,
			reuseExistingServer: false,
			timeout: 30_000,
		},
		{
			command: 'npm run e2e:generation-server',
			url: 'http://127.0.0.1:43180/api/health',
			reuseExistingServer: false,
			timeout: 30_000,
		},
		{
			command: 'npm run e2e:retry-server',
			url: 'http://127.0.0.1:43183/api/health',
			reuseExistingServer: false,
			timeout: 30_000,
		},
		{
			command: 'npm run e2e:chat-server',
			url: 'http://127.0.0.1:43185/api/health',
			reuseExistingServer: false,
			timeout: 30_000,
		},
		{
			command: 'npm run e2e:strict-web',
			url: 'http://127.0.0.1:43189',
			reuseExistingServer: false,
			timeout: 30_000,
		},
	],
});
