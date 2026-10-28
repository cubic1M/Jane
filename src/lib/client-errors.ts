import { scrub, scrubPath } from "@/lib/scrub";

// A page that broke in the person's browser (src/app/error.tsx), as /admin/errors keeps it: what
// failed and where, never what anyone typed. On top of the usual scrubbing (emails, numbers,
// keys), anything in quotes and any amount goes: an input's value lands in messages that way
// ("Invalid amount '1,240.50'").

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;

function withoutTyped(text: string): string {
  return scrub(text)
    .replace(/(["'`])(?:(?!\1).){1,500}\1/g, "[text]")
    .replace(/\$?\d[\d,]*\.\d+|\$\d[\d,]*|\b\d{3,}\b/g, "[n]");
}

export type ClientError = { message: string; stack: string | null; path: string | null };

export function describeClientError(input: unknown): ClientError | null {
  if (typeof input !== "object" || input === null) return null;
  const { name, message, stack, path } = input as Record<string, unknown>;
  if (typeof message !== "string" || !message.trim()) return null;
  const label = typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
  return {
    message: withoutTyped(`${label}: ${message}`).slice(0, MAX_MESSAGE),
    stack: typeof stack === "string" ? withoutTyped(stack).slice(0, MAX_STACK) : null,
    path: typeof path === "string" && path.startsWith("/") ? scrubPath(path) : null,
  };
}
