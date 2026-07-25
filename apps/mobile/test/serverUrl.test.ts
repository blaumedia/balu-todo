import { describe, expect, it } from 'vitest';
import { hasExplicitScheme, isInsecureUrl, normalizeUrl, toInsecureUrl } from '../src/lib/serverUrl';

describe('normalizeUrl', () => {
  it('defaults a bare host to https, not http (S8)', () => {
    // The whole point of the fix: typing a hostname must not silently put the
    // password and bearer token on the wire in the clear.
    expect(normalizeUrl('balu.example.com')).toBe('https://balu.example.com');
    expect(normalizeUrl('192.168.1.10:8080')).toBe('https://192.168.1.10:8080');
    expect(normalizeUrl('  balu.example.com  ')).toBe('https://balu.example.com');
  });

  it('preserves an explicitly written scheme', () => {
    expect(normalizeUrl('http://192.168.1.10:8080')).toBe('http://192.168.1.10:8080');
    expect(normalizeUrl('https://balu.example.com')).toBe('https://balu.example.com');
    expect(normalizeUrl('HTTP://Balu.Example.com')).toBe('http://balu.example.com');
  });

  it('strips path, query and fragment down to the origin', () => {
    expect(normalizeUrl('https://balu.example.com/api/v1')).toBe('https://balu.example.com');
    expect(normalizeUrl('https://balu.example.com/x?y=1#z')).toBe('https://balu.example.com');
    expect(normalizeUrl('https://balu.example.com:8443/deep/path')).toBe(
      'https://balu.example.com:8443',
    );
  });

  it('rejects empty and unusable input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('http://')).toBeNull();
    expect(normalizeUrl('://nope')).toBeNull();
  });

  it('rejects non-http(s) schemes', () => {
    // `javascript:` / `file:` must never reach fetch() or the WebView.
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('ftp://balu.example.com')).toBeNull();
    expect(normalizeUrl('data:text/html,hi')).toBeNull();
  });
});

describe('isInsecureUrl', () => {
  it('flags cleartext origins only', () => {
    expect(isInsecureUrl('http://balu.example.com')).toBe(true);
    expect(isInsecureUrl('HTTP://balu.example.com')).toBe(true);
    expect(isInsecureUrl('https://balu.example.com')).toBe(false);
    // Not fooled by "http" appearing inside an https host.
    expect(isInsecureUrl('https://http.example.com')).toBe(false);
  });
});

describe('hasExplicitScheme', () => {
  it('distinguishes a typed scheme from an assumed one', () => {
    // Drives the error copy: only an *assumed* https warrants explaining the
    // default and offering http://.
    expect(hasExplicitScheme('balu.example.com')).toBe(false);
    expect(hasExplicitScheme('192.168.1.10:8080')).toBe(false);
    expect(hasExplicitScheme('  balu.example.com  ')).toBe(false);
    expect(hasExplicitScheme('http://balu.example.com')).toBe(true);
    expect(hasExplicitScheme('HTTPS://balu.example.com')).toBe(true);
  });
});

describe('toInsecureUrl', () => {
  it('offers the cleartext twin of an https origin', () => {
    expect(toInsecureUrl('https://192.168.1.10:8080')).toBe('http://192.168.1.10:8080');
    expect(toInsecureUrl('HTTPS://balu.example.com')).toBe('http://balu.example.com');
  });

  it('leaves an already-http origin alone', () => {
    expect(toInsecureUrl('http://192.168.1.10:8080')).toBe('http://192.168.1.10:8080');
  });

  it('only rewrites the scheme, not an https elsewhere in the host', () => {
    expect(toInsecureUrl('https://https.example.com')).toBe('http://https.example.com');
  });
});
