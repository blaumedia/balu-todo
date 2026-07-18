import { defineConfig } from 'vitest/config';

// Unit tests here cover the pure, framework-free logic modules under src/lib
// (reminder reconcile + replica search). React Native / Expo screens are not
// unit-tested — they need the Metro/RN runtime and are exercised via expo
// export + on-device (see README).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
