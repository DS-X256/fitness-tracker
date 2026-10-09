import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: './tests/browser', workers: 1, timeout: 120_000,
	use: { baseURL: 'http://127.0.0.1:5187', viewport: { width: 390, height: 844 }, launchOptions: {
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
		args: ['--no-sandbox']
	} }
});
