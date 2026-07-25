// parseQuickAdd — turns a natural-language quick-add string into a structured
// task draft plus token spans for live pill highlighting. German + English.

import { buildMatchers, SYMBOL_MATCHERS, type Matcher } from "./grammar.js";
import { buildTitle } from "./title.js";
import type { ParseOptions, ParseResult, Token } from "./types.js";

export type { Locale, ParseOptions, ParseResult, Token, TokenType } from "./types.js";
export { buildTitle } from "./title.js";
export {
  composeTaskArgs,
  type ComposeContext,
  type ComposeOptions,
  type NamedEntity,
} from "./compose.js";

interface Candidate extends Token {
  order: number; // tie-break: lower = higher priority
}

function collect(
  text: string,
  ref: string,
  matchers: Matcher[],
  startOrder: number,
  out: Candidate[],
): number {
  let order = startOrder;
  for (const matcher of matchers) {
    matcher.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = matcher.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        matcher.re.lastIndex += 1;
        continue;
      }
      const payload = matcher.build(m, ref);
      if (payload) {
        out.push({
          type: payload.type,
          value: payload.value,
          start: m.index,
          end: m.index + m[0].length,
          order,
        });
      }
    }
    order += 1;
  }
  return order;
}

/** Greedy longest-match / earliest-wins overlap resolution. */
function resolve(cands: Candidate[]): Candidate[] {
  cands.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const la = a.end - a.start;
    const lb = b.end - b.start;
    if (la !== lb) return lb - la; // longer first
    return a.order - b.order;
  });
  const chosen: Candidate[] = [];
  let lastEnd = -1;
  for (const c of cands) {
    if (c.start >= lastEnd) {
      chosen.push(c);
      lastEnd = c.end;
    }
  }
  return chosen;
}

export function parseQuickAdd(text: string, opts: ParseOptions): ParseResult {
  const ref = opts.referenceDate;
  const cands: Candidate[] = [];
  const afterSymbols = collect(text, ref, SYMBOL_MATCHERS, 0, cands);
  collect(text, ref, buildMatchers(opts.locale), afterSymbols, cands);

  const chosen = resolve(cands).sort((a, b) => a.start - b.start);

  const result: ParseResult = { title: "", labelQueries: [], tokens: [] };
  for (const c of chosen) {
    const token: Token = { type: c.type, start: c.start, end: c.end, value: c.value };
    result.tokens.push(token);
    switch (c.type) {
      case "start":
        result.startDate = String(c.value);
        break;
      case "deadline":
        result.deadline = String(c.value);
        break;
      case "evening":
        result.evening = true;
        result.startDate = String(c.value);
        break;
      case "priority":
        result.priority = Number(c.value);
        break;
      case "project":
        result.projectQuery = String(c.value);
        break;
      case "label":
        result.labelQueries.push(String(c.value));
        break;
      case "recurrence":
        result.recurrence = String(c.value);
        break;
    }
  }

  result.title = buildTitle(text, chosen);
  return result;
}
