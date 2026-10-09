import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)), '$env/dynamic/private': fileURLToPath(new URL('./tests/env.ts', import.meta.url)) } },
	test: { include: ['tests/**/*.test.ts'], fileParallelism: false }
});
