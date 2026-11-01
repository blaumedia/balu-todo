// Shared ESLint 9 flat config for packages/* (via eslint.config.js) and apps/web.
// apps/mobile builds on eslint-config-expo instead (apps/mobile/eslint.config.js).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/dist/**", "**/coverage/**"] },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `const { omitted, ...rest } = x` is how this codebase drops a key, and
      // `_today` keeps the shared (task, today) signature of the smart-list predicates.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Test doubles are cast to `any` on purpose (partial stores, fake clients);
    // typing every mock buys nothing the assertions do not already check.
    files: ["**/test/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];
