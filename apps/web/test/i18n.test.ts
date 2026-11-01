import { describe, expect, it } from "vitest";
import { de } from "../src/i18n/de.js";
import { en } from "../src/i18n/en.js";

describe("i18n dictionaries", () => {
  it.each([["en", en], ["de", de]] as const)("%s has no em or en dashes", (_name, dict) => {
    const offenders = Object.entries(dict).filter(([, v]) => /[\u2013\u2014]/.test(v)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });
});
