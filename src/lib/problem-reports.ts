import type { ScopedDb } from "@/lib/db-scoped";

// "Send feedback" (closed beta): the person's own words and the page they were on, kept for the
// founders (/admin/reports) and emailed to them. Nothing else goes with it: no balances, no
// transactions, no analytics. A screenshot is only what the person chose to attach: it's encrypted,
// shown only on /admin/reports, and never emailed. Deleted with the person. A trial person's goes to
// src/lib/try-feedback.ts instead.

export const REPORT_MAX_CHARS = 2000;
const PATH_MAX_CHARS = 200;

// The page a report is about: its path only. A query is dropped (a search's words are the
// person's), and anything that isn't one of our own pages is just "/".
export function reportPath(from: unknown): string {
  // Browsers read "/\\" as "//", and drop tabs and line breaks anywhere in a link: all lead to
  // another site.
  if (typeof from !== "string" || !/^\/(?![/\\])/.test(from) || /[\s\\]/.test(from)) return "/";
  return from.split(/[?#]/)[0].slice(0, PATH_MAX_CHARS) || "/";
}

// What to keep, or what's wrong with it.
export function cleanReport(
  from: unknown,
  message: unknown,
): { path: string; message: string } | string {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "Say what went wrong, in a few words.";
  if (text.length > REPORT_MAX_CHARS) {
    return `Keep it under ${REPORT_MAX_CHARS.toLocaleString("en-US")} characters.`;
  }
  return { path: reportPath(from), message: text };
}

// Under the 5 MB a server action may carry (next.config.ts), with room for the words.
export const FEEDBACK_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type Screenshot = { bytes: Uint8Array; type: "image/png" | "image/jpeg" | "image/webp" };

const startsWith = (bytes: Uint8Array, head: number[], at = 0) =>
  head.every((b, i) => bytes[at + i] === b);

// What the file really is, by its first bytes (never the name or the browser's word for it).
export function imageType(bytes: Uint8Array): Screenshot["type"] | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return null;
}

// The attached screenshot, none, or what's wrong with it.
export async function cleanScreenshot(file: unknown): Promise<Screenshot | null | string> {
  if (!(file instanceof Blob) || file.size === 0) return null;
  if (file.size > FEEDBACK_MAX_UPLOAD_BYTES) return "That picture is too big. Try one under 4 MB.";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return "Attach a screenshot as a PNG, JPEG or WebP picture.";
  return { bytes, type };
}

// `screenshot`: already encrypted by the caller (encryptBytes, src/lib/crypto.ts), which keeps this
// file free of server-only code: the form reads its limits from here.
export async function saveProblemReport(
  db: Pick<ScopedDb, "userId" | "problemReports">,
  report: { path: string; message: string },
  screenshot: { encrypted: Uint8Array<ArrayBuffer>; type: Screenshot["type"] } | null = null,
): Promise<string> {
  const row = await db.problemReports.create({
    data: {
      userId: db.userId,
      path: report.path,
      message: report.message,
      ...(screenshot && {
        screenshotEncrypted: screenshot.encrypted,
        screenshotType: screenshot.type,
      }),
    },
    select: { id: true },
  });
  return row.id;
}
