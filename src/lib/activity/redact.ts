import { ACTIVITY } from "@/config/activity";

// What the activity log may keep of text on the page, run in the browser before anything is
// sent and again on the server before anything is stored. Imported by the browser, so it
// stays free of server code.

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;
// Any figure: amounts, account and card digits, dates, counts. "$1,200.50", "••1234", "12%".
const NUMBER = /[$€£¥]?\d(?:[\d,.:/-]*\d)?%?/g;

// Visible text made safe to store: emails and numbers replaced, whitespace squeezed, cut short.
export function redactText(text: string, max: number = ACTIVITY.maxLabel): string {
  const clean = text.replace(EMAIL, "[email]").replace(NUMBER, "#").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// A form or field name from the page's code (name, id, data-track): letters, digits and a
// little punctuation, never anything typed.
export function cleanName(name: string): string {
  return redactText(name)
    .replace(/[^\w .:#[\]…-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A path segment that looks like a token or an id (share links, unsubscribe links, record
// ids) is replaced, so the log can't hold a working link. Paths come without a query string.
const ID_LIKE = /^(?=.*\d)[\w-]{8,}$|^[\w-]{20,}$/;

export function normalizePath(path: string): string {
  const bare = path.split(/[?#]/)[0] || "/";
  const segments = bare
    .split("/")
    .map((s) => (ID_LIKE.test(s) ? ":id" : s.slice(0, 40)))
    .slice(0, 8);
  const joined = segments.join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

// Fields that are private whatever the page says: what their length alone could give away
// (an amount's digits, a name, an account number). Marking a field data-private is the sure way.
const PRIVATE_TYPES = new Set(["password", "email", "tel", "number"]);
const PRIVATE_INPUT_MODES = new Set(["decimal", "numeric", "email", "tel"]);
const PRIVATE_AUTOCOMPLETE =
  /^(cc-|email|tel|street|address|postal|bday|name|given|family|one-time)/;
const PRIVATE_NAME =
  /amount|balance|cents|dollars|price|cost|income|salary|pay|rate|account|routing|card|ssn|tax.?id|email|phone|address|birth|dob|name|invite|code/i;

export function isPrivateField(field: {
  type?: string | null;
  inputMode?: string | null;
  autocomplete?: string | null;
  name?: string | null;
  markedPrivate: boolean;
}): boolean {
  if (field.markedPrivate) return true;
  if (field.type && PRIVATE_TYPES.has(field.type.toLowerCase())) return true;
  if (field.inputMode && PRIVATE_INPUT_MODES.has(field.inputMode.toLowerCase())) return true;
  if (field.name && PRIVATE_NAME.test(field.name)) return true;
  return !!field.autocomplete && PRIVATE_AUTOCOMPLETE.test(field.autocomplete.toLowerCase());
}
