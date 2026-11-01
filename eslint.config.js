// Serves packages/*: ESLint 9 looks for the config from the working directory
// upwards, so `pnpm --filter @balu/domain lint` lands here. The apps carry their
// own config; run `pnpm lint` rather than eslint from the repo root.
import base from "./eslint.base.js";

export default [{ ignores: ["apps/**", "server/**", "tools/**", "docs/**"] }, ...base];
