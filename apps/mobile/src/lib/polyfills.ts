// Polyfill `crypto.randomUUID` / `crypto.getRandomValues` for Hermes.
// @balu/sync-client generates command uuids via `globalThis.crypto.randomUUID()`,
// which Hermes does not provide out of the box. Import this once, first thing.
import * as Crypto from 'expo-crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

if (typeof g.crypto === 'undefined') {
  g.crypto = {};
}
if (typeof g.crypto.randomUUID !== 'function') {
  g.crypto.randomUUID = () => Crypto.randomUUID();
}
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = (array: unknown) => Crypto.getRandomValues(array as Parameters<typeof Crypto.getRandomValues>[0]);
}
