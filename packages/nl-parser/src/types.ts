export type Locale = "de" | "en";

export type TokenType =
  | "start" // start_date
  | "deadline" // deadline
  | "evening" // → start today + evening flag
  | "priority"
  | "project"
  | "label"
  | "recurrence";

/** A recognized span in the input, for live pill highlighting. */
export interface Token {
  type: TokenType;
  /** Inclusive start offset into the original text. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /**
   * The parsed value: an ISO date for start/deadline/evening, the RRULE string
   * for recurrence, the priority number for priority, or the raw query for
   * project/label.
   */
  value: string | number;
}

export interface ParseResult {
  /** Input with all recognized tokens stripped and whitespace collapsed. */
  title: string;
  startDate?: string;
  deadline?: string;
  evening?: boolean;
  priority?: number;
  /** Bare `#project` name (unquoted) — the app resolves it against the replica. */
  projectQuery?: string;
  /** Every `@label` name in order. */
  labelQueries: string[];
  /** RRULE subset string (contract §3.3). */
  recurrence?: string;
  tokens: Token[];
}

export interface ParseOptions {
  locale: Locale;
  /** `YYYY-MM-DD` reference "today" for relative dates. */
  referenceDate: string;
}
