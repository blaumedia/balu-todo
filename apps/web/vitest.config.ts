import { defineConfig } from 'vitest/config';

// Unit tests cover the framework-free logic in src/lib and the store; component
// tests opt into jsdom per file.
export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
