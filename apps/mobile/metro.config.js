// Metro config tuned for the Balu pnpm monorepo.
//
// Two things need handling that a stock Expo app doesn't have:
//   1. Workspace packages live in ../../packages/* and their deps are hoisted to
//      the workspace-root node_modules — Metro must watch the root and resolve
//      modules from both node_modules trees.
//   2. @balu/* packages ship raw TypeScript (`main: ./src/index.ts`) whose
//      relative imports use `.js` extensions (ESM/NodeNext style) that actually
//      point at `.ts` files. Metro must retry a failed `.js` resolution as `.ts`.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so edits in packages/* trigger reloads.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the hoisted workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Map `./foo.js` imports inside @balu/* source onto their real `./foo.ts`
//    (and `.tsx`) files. Falls back to the default resolver for everything else.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      const base = moduleName.slice(0, -'.js'.length);
      for (const ext of ['.ts', '.tsx']) {
        try {
          return resolve(context, base + ext, platform);
        } catch {
          /* try next */
        }
      }
      throw new Error(`Metro could not resolve ${moduleName}`);
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
