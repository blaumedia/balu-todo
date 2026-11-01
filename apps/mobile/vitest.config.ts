import { defineConfig } from 'vitest/config';

// Unit tests cover the pure logic modules under src/lib and, with react-native
// mocked, a few components called as plain functions (e.g. SyncIndicator,
// the root layout). Screen wiring needs the Metro/RN runtime and is exercised
// via expo export + on-device (see README).
export default defineConfig({
  // Component tests call a .tsx component as a function; the automatic runtime needs no React global.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
