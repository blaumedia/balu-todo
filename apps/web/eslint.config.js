import reactHooks from "eslint-plugin-react-hooks";
import base from "../../eslint.base.js";

export default [
  ...base,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    // Same major (5.x) and rule set eslint-config-expo uses for mobile.
    rules: reactHooks.configs.recommended.rules,
  },
];
