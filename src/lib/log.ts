import { scrub } from "@/lib/scrub";

// The one way app code writes to the logs (founder's hardening plan, item 10). Log drains copy
// lines out as they are and redact nothing, so what must never leave is taken out here: tokens,
// emails and account numbers (src/lib/scrub.ts), plus what a bank statement or a person's words
// look like inside an error: anything in quotes (Prisma and validation errors quote the values
// they were given), dollar amounts, and whatever sits under a field name like "description".
// Only an Error's name, cleaned message, code and status are kept: an HTTP client's error also
// carries its whole request, Plaid's access token included. docs/security/logging.md.

const MAX_TEXT = 300;
// Longest text the cleaning will read: a huge error mustn't slow a request down. A quote cut here
// never closes, so it's removed with everything after it.
const MAX_INPUT = 20_000;
const MAX_ITEMS = 50;
const MAX_DEPTH = 4;
const REMOVED = "[removed]";

// A field is dropped when any word of its name is one of these...
const ALWAYS_SENSITIVE = new Set(
  "token secret password passwd pwd cookie authorization credential credentials email ssn merchant payee statement prompt transcript description".split(
    " ",
  ),
);
// ...or when its name ends in one of these ("inputTokens" and "textLength" are only counts).
const SENSITIVE_LAST_WORD = new Set(
  "input output text content contents body data query args question answer memo note notes address phone raw key headers config request response html session".split(
    " ",
  ),
);

function sensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((word) => word.toLowerCase());
  const last = words[words.length - 1];
  return (
    words.some((word) => ALWAYS_SENSITIVE.has(word)) ||
    SENSITIVE_LAST_WORD.has(last) ||
    // Bare "name" is a tool or a job; "merchantName" or "firstName" is someone's.
    (last === "name" && words.length > 1)
  );
}

// Text as it may appear in a log. Removal comes before the cut, so a long quote is gone whole
// rather than kept up to the limit, and a quote that never closes takes the rest with it.
export function logText(text: string): string {
  const clean = scrub(text.slice(0, MAX_INPUT))
    .replace(/(https?:\/\/[^\s?#"'`]+)[?#][^\s"'`]*/g, "$1")
    .replace(/(["`])[\s\S]*?\1/g, "[text]")
    .replace(/(?<![A-Za-z0-9])'[\s\S]*?'(?![A-Za-z0-9])/g, "[text]")
    .replace(/(?:["`]|(?<![A-Za-z0-9])')[\s\S]*$/, "[text]")
    .replace(/\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\.\d{2}\b|\b\d{5,}\b/g, "[n]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[long]")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT)}…` : clean;
}

function cleanError(error: Error): Record<string, unknown> {
  const { code, status } = error as Error & { code?: unknown; status?: unknown };
  return {
    name: logText(error.name),
    message: logText(error.message),
    ...(typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code) ? { code } : {}),
    ...(typeof status === "number" ? { status } : {}),
  };
}

export function cleanForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return logText(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return cleanError(value);
  if (typeof value !== "object" || depth >= MAX_DEPTH) return REMOVED;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => cleanForLog(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_ITEMS)
      .map(([key, item]) => [key, sensitiveKey(key) ? REMOVED : cleanForLog(item, depth + 1)]),
  );
}

type Level = "error" | "warn" | "info";

function write(level: Level, event: string, detail?: unknown) {
  if (detail === undefined) console[level](scrub(event));
  else console[level](scrub(event), cleanForLog(detail));
}

export const log = {
  error: (event: string, detail?: unknown) => write("error", event, detail),
  warn: (event: string, detail?: unknown) => write("warn", event, detail),
  info: (event: string, detail?: unknown) => write("info", event, detail),
  // A measurement, as one line of JSON that can be searched for in the logs.
  json: (event: string, fields: Record<string, unknown>) =>
    console.info(scrub(event), JSON.stringify(cleanForLog(fields))),
  // Local development only, printed as is (a magic link, an email that wasn't sent). In
  // production this says nothing at all, whoever calls it.
  dev: (text: string) => {
    if (process.env.NODE_ENV !== "production") console.info(text);
  },
};

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

// What a library or the framework prints itself (Next.js writes a failed page's Error straight
// to the console): the same cleaning on everything, once, at start-up in production
// (src/instrumentation.ts). Text stays readable: only secrets go, since log lines such as
// log.json's are text too.
export function scrubConsole(target: Pick<Console, (typeof CONSOLE_METHODS)[number]> = console) {
  for (const method of CONSOLE_METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) =>
      original(...args.map((arg) => (typeof arg === "string" ? scrub(arg) : cleanForLog(arg))));
  }
}
