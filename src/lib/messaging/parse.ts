import { TEXT_INBOUND_MAX_LENGTH } from "@/config/messaging";

// What a reply to Jane means (spec step 78). Only these exact forms are acted on; anything
// else is "other" and gets a short note pointing to the app. Free text never approves
// anything.

export type TextIntent =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "numbers"; numbers: number[] }
  | { kind: "undo" }
  | { kind: "stop" }
  | { kind: "start" }
  | { kind: "help" }
  | { kind: "other" };

// The carrier-standard opt-out words, and the ones Sendblue itself recognises.
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);
const YES_WORDS = new Set(["YES", "Y", "OK", "OKAY", "👍"]);
const NO_WORDS = new Set(["NO", "N"]);
const UNDO_WORDS = new Set(["UNDO"]);

// The most item numbers one reply may hold.
const MAX_NUMBERS = 20;

export function parseReply(raw: string): TextIntent {
  // Whitespace, a trailing full stop or exclamation mark, and emoji skin tones don't change
  // the meaning; anything else does.
  const text = raw
    .slice(0, TEXT_INBOUND_MAX_LENGTH)
    .normalize("NFKC")
    .replace(/[\u{1F3FB}-\u{1F3FF}️]/gu, "")
    .trim()
    .replace(/[.!]+$/, "")
    .trim();
  const word = text.toUpperCase();
  if (STOP_WORDS.has(word)) return { kind: "stop" };
  if (START_WORDS.has(word)) return { kind: "start" };
  if (HELP_WORDS.has(word)) return { kind: "help" };
  if (YES_WORDS.has(word)) return { kind: "yes" };
  if (NO_WORDS.has(word)) return { kind: "no" };
  if (UNDO_WORDS.has(word)) return { kind: "undo" };
  // "1 3", "1,3", "1, 3", "1 and 3", "#2".
  if (/^#?\d{1,2}(\s*(,|\s|&|AND)\s*#?\d{1,2})*$/.test(word)) {
    const numbers = [...new Set((word.match(/\d{1,2}/g) ?? []).map(Number))];
    if (numbers.length > 0 && numbers.length <= MAX_NUMBERS && numbers.every((n) => n >= 1)) {
      return { kind: "numbers", numbers: numbers.sort((a, b) => a - b) };
    }
  }
  return { kind: "other" };
}
