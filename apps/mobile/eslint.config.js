// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');

// typescript-eslint's recommended rules without its plugin/parser registration:
// eslint-config-expo registers its own @typescript-eslint plugin object for TS
// files, and a second object under the same name is a "Cannot redefine plugin"
// error. Severity-only entries keep expo's rule options.
const tsRecommendedRules = Object.assign({}, ...tseslint.configs.recommended.map((c) => c.rules ?? {}));

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/**', 'web-build/**', '.expo/**', 'android/**', 'ios/**', 'expo-env.d.ts'] },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  { files: ['**/*.ts', '**/*.tsx'], rules: tsRecommendedRules },
  {
    // Test doubles are cast to `any` on purpose (see eslint.base.js at the root).
    files: ['**/test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // eslint-config-expo 58 brings eslint-plugin-react-hooks 7, whose React Compiler
    // rules flag existing code (reanimated shared values, ref reads in render,
    // setState in effects). Addressing them is its own change, not part of the SDK bump.
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
]);
