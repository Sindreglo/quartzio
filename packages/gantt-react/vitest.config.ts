import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['@quartzio/source'],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
