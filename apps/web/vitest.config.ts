import { defineConfig } from 'vitest/config';

// Unit tests here cover the pure, framework-free logic modules under src/lib
// (URL <-> view mapping). React components are not unit-tested - they are
// exercised via the vite build + in the browser.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
