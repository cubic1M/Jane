import { SHARED_SUFFIXES } from "@/config/agent";
import { GMAIL_LIMITS } from "@/config/gmail";

// One message as Gmail's API answers it, narrowed field by field: the headers Jane looks at, the
// sender's domain as Google checked it, and the text of the body. Pure: no call, no clock, and
// nothing is kept or logged. Everything in a message was written by whoever sent it
// (src/lib/untrusted-text.ts), at the length they chose, so each header is refused past a limit and
// then read in one pass: nothing here can be made to start over from every position.
//
// What the sender check can and can't say (docs/setup/gmail.md). A pass names the domain an email
// came from, not an honest company. The mailbox's owner, or an app they let add mail, can make any
// sender look checked: such mail never passed Google's own servers. Google documents neither the
// header's exact form nor that it removes a copy the sender wrote, so more than one header in
// Google's name is never trusted, whatever order they come in: mail forwarded from another Gmail,
// or through Google Groups, carries two and is skipped.

type Obj = Record<string, unknown>;

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type MailMeta = {
  // Gmail's id for the message.
  id: string;
  labelIds: string[];
  // The first line or two, as Gmail cut it. Empty when Gmail sent none.
  snippet: string;
  // When Google took the email in. Gmail doesn't promise it: null when it's missing, and the caller
  // skips such a message.
  receivedAt: Date | null;
  // Gmail's own estimate of the whole email, in bytes, when it gave one.
  sizeEstimate: number | null;
  // Every From header, as written. More than one is how an email shows one sender and passes as
  // another.
  from: string[];
  subject: string;
  // Every Authentication-Results header: Google's, and any the sender wrote.
  authResults: string[];
  // It carries X-Gmail-Fetch-Info: Gmail fetched it from another mailbox, so Google's servers never
  // checked who sent it.
  fetched: boolean;
};

type Header = { name: string; value: string };

// A part's headers with their names lowered, or null when they aren't names and values.
function headersOf(part: Obj): Header[] | null {
  if (part.headers === undefined) return [];
  if (!Array.isArray(part.headers)) return null;
  const headers: Header[] = [];
  for (const header of part.headers) {
    if (!isObject(header) || typeof header.name !== "string" || typeof header.value !== "string") {
      return null;
    }
    headers.push({ name: header.name.toLowerCase(), value: header.value });
  }
  return headers;
}

// Gmail writes the time as milliseconds since 1970, in a string.
function momentOf(internalDate: unknown): Date | null {
  if (typeof internalDate !== "string" || !/^\d{1,15}$/.test(internalDate)) return null;
  return new Date(Number(internalDate));
}

// What Jane looks at before it decides whether to read an email. Null when the answer isn't shaped
// like a message: the caller skips it.
export function mailMeta(raw: unknown): MailMeta | null {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  // Gmail leaves both out when there is nothing to say.
  const { labelIds = [], snippet = "", sizeEstimate } = raw;
  if (!Array.isArray(labelIds)) return null;
  if (!labelIds.every((label): label is string => typeof label === "string")) return null;
  if (typeof snippet !== "string") return null;
  const headers = isObject(raw.payload) ? headersOf(raw.payload) : null;
  if (headers === null) return null;
  const all = (name: string) => headers.filter((h) => h.name === name).map((h) => h.value);
  return {
    id: raw.id,
    labelIds,
    snippet,
    receivedAt: momentOf(raw.internalDate),
    sizeEstimate:
      typeof sizeEstimate === "number" && Number.isFinite(sizeEstimate) && sizeEstimate >= 0
        ? sizeEstimate
        : null,
    from: all("from"),
    subject: all("subject")[0] ?? "",
    authResults: all("authentication-results"),
    fetched: all("x-gmail-fetch-info").length > 0,
  };
}

// A long header is written over several lines, each after the first starting with a space.
const FOLD = /\r?\n(?=[ \t])/g;
const CONTROL = /[\u0000-\u001f\u007f]/;
const BACKSLASH = "\\";

// A header's value on one line. Null when it holds a control character other than a fold or a tab:
// none belongs in a header, and one is how a second header is slipped inside the first.
function unfolded(header: string): string | null {
  const text = header.replace(FOLD, "").replaceAll("\t", " ");
  return CONTROL.test(text) ? null : text;
}

// A From header without its quoted display name and its comments "( )", in one pass. Each leaves a
// space behind, so what stood on either side can't join into a word that was never written. Null
// when it can't be read for certain: a quote or a bracket that never closes, a bracket that closes
// nothing, or a backslash outside a name. Inside a name's quotes or a comment, a backslash makes
// the next character part of the name.
function withoutNames(from: string): string | null {
  const text = unfolded(from);
  if (text === null) return null;
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === BACKSLASH) {
      if (!quoted && depth === 0) return null;
      i++;
    } else if (quoted) {
      if (c === '"') {
        quoted = false;
        out += " ";
      }
    } else if (depth > 0) {
      // Inside a comment a quote is only a character, and a comment may hold another.
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) out += " ";
    } else if (c === '"') {
      quoted = true;
    } else if (c === "(") {
      depth = 1;
    } else if (c === ")") {
      return null;
    } else {
      out += c;
    }
  }
  return depth === 0 && !quoted ? out : null;
}

// Google's header without its comments, in one pass, each leaving a space behind. Google copies
// the envelope sender into this header twice, once inside a comment and once outside, and that
// address is the sender's to write. So the header is refused, not repaired, when it holds anything
// that could make such a copy read as Google's own words: a quote or a backslash anywhere (Google
// writes neither), a semicolon inside a comment (a copy that made a clause outside one would show
// it here), a bracket that never closes, or one that closes nothing.
function withoutComments(header: string): string | null {
  const text = unfolded(header);
  if (text === null) return null;
  let out = "";
  let depth = 0;
  for (const c of text) {
    if (c === '"' || c === BACKSLASH) return null;
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      if (depth === 0) return null;
      if (--depth === 0) out += " ";
    } else if (depth === 0) {
      out += c;
    } else if (c === ";") {
      return null;
    }
  }
  return depth === 0 ? out : null;
}

const LABEL = /^[A-Za-z0-9-]+$/;

// The domain of the one address in the one From header, lowered. Null for no From header or
// several, one over the limit, a list or a group of addresses, and a domain that isn't plain
// letters, digits and hyphens (a look-alike in another alphabet arrives in its "xn--" form and
// stays in it).
export function fromDomain(meta: MailMeta): string | null {
  const [from] = meta.from;
  if (meta.from.length !== 1 || from.length > GMAIL_LIMITS.headerChars) return null;
  // A display name in quotes may hold commas, brackets and an address of its own: it's only a name.
  const text = withoutNames(from);
  if (text === null) return null;
  let address = text;
  if (/[<>]/.test(text)) {
    // "Name <address>": one pair of brackets with nothing after it, and before it a name that
    // holds no second address and no list.
    const bracketed = /^[^@,<>]*<([^<>]*)>\s*$/.exec(text);
    if (!bracketed) return null;
    address = bracketed[1];
  }
  address = address.trim();
  const at = address.indexOf("@");
  if (at < 1 || /[\s,;:]/.test(address)) return null;
  // Everything after the first "@": a second one, like any other odd character, fails here. The
  // letters are checked as written, before they are lowered: some letters of other alphabets
  // lower to plain ones.
  const domain = address.slice(at + 1);
  const labels = domain.split(".");
  // A name ends in letters; an address made of numbers isn't a company's.
  const named = labels.every((label) => LABEL.test(label)) && /[A-Za-z]/.test(labels.at(-1) ?? "");
  return named ? domain.toLowerCase() : null;
}

const GOOGLE = "mx.google.com";

// Whether a header says Google's servers wrote it. Loose on purpose (any spelling, anything around
// the name): this decides which headers count, and a header that only looks like Google's must
// count, so that it can't sit beside the real one unseen.
function namesGoogle(header: string): boolean {
  const end = header.indexOf(";");
  return (end === -1 ? header : header.slice(0, end)).toLowerCase().includes(GOOGLE);
}

// The domain Google's header says passed DMARC, lowered, or null. Strict on purpose: the header
// must be Google's own name and then clauses, with exactly one "dmarc" clause, and that clause
// must read "dmarc=pass header.from=<domain>" and nothing else once comments are out. A pass or a
// domain found anywhere else in the header proves nothing: "dmarc=pass" is ordinary text in an
// address, and the sender chooses the address Google copies in.
function dmarcPass(header: string): string | null {
  // Never cut: Google writes its dmarc clause last, after values the sender shapes.
  if (header.length > GMAIL_LIMITS.headerChars) return null;
  const text = withoutComments(header);
  if (text === null) return null;
  const [server, ...clauses] = text.split(";").map((part) => part.split(" ").filter(Boolean));
  if (server.length !== 1 || server[0].toLowerCase() !== GOOGLE) return null;
  // Counted loosely, as Google's name is: a verdict written any other way ("dmarc/1=fail",
  // "dmarc = fail") is still a second verdict, and never a pass.
  const dmarc = clauses.filter(([first = ""]) => first.toLowerCase().startsWith("dmarc"));
  if (dmarc.length !== 1 || dmarc[0].length !== 2) return null;
  const [method, result, ...rest] = dmarc[0][0].split("=");
  const [property, domain = "", ...more] = dmarc[0][1].split("=");
  const passed = method.toLowerCase() === "dmarc" && result === "pass" && rest.length === 0;
  const named = property.toLowerCase() === "header.from" && more.length === 0;
  // Plain letters only, as for the From header's own domain, and for the same reason.
  return passed && named && /^[A-Za-z0-9.-]+$/.test(domain) ? domain.toLowerCase() : null;
}

// A domain that is shown may hold this many digits in a row and this many hyphens. More reads as a
// phone number or a sentence ("refund-desk-call-888-555-0142"), and a name is all of a sender's
// that reaches the page.
const SHOWN_DIGITS_IN_A_ROW = 3;
const SHOWN_HYPHENS = 3;
const TOO_MANY_DIGITS = new RegExp(`\\d{${SHOWN_DIGITS_IN_A_ROW + 1}}`);

// The part of a domain a company registers: its last two labels, or three where the last two are
// an ending many companies share (co.uk). What stands before it costs a sender nothing to write,
// so it is never shown.
function shownPart(domain: string): string | null {
  const labels = domain.split(".");
  const keep = SHARED_SUFFIXES.includes(labels.slice(-2).join(".")) ? 3 : 2;
  if (labels.length < keep) return null;
  const shown = labels.slice(-keep).join(".");
  const reads =
    shown.length <= GMAIL_LIMITS.shownDomainChars &&
    !TOO_MANY_DIGITS.test(shown) &&
    shown.split("-").length - 1 <= SHOWN_HYPHENS;
  return reads ? shown : null;
}

// The sender's domain as Google checked it, cut to the part that is saved and shown, or null when
// Google didn't vouch for it. All of these must hold: one From header with one address; Gmail
// didn't fetch the email from elsewhere; exactly one header in Google's name; that header says
// DMARC passed for the From address's own domain (the same domain, not a parent of it, and never a
// DKIM signature alone).
export function verifiedSender(meta: MailMeta): string | null {
  const domain = fromDomain(meta);
  if (domain === null || meta.fetched) return null;
  const google = meta.authResults.filter(namesGoogle);
  if (google.length !== 1 || dmarcPass(google[0]) !== domain) return null;
  return shownPart(domain);
}

type Found = { plain: string | null; html: string | null; seen: number };

// The character set a part says its text is in.
function charsetOf(part: Obj): string {
  const type = headersOf(part)?.find((header) => header.name === "content-type")?.value ?? "";
  const named = type.slice(0, GMAIL_LIMITS.headerChars).toLowerCase();
  const at = named.indexOf("charset=");
  if (at === -1) return "utf-8";
  return /^"?([a-z0-9._:-]+)/.exec(named.slice(at + "charset=".length))?.[1] ?? "utf-8";
}

// A part's text, cut to what is ever looked at. Null when the part carries none.
function textOf(part: Obj): string | null {
  const data = isObject(part.body) ? part.body.data : undefined;
  if (typeof data !== "string" || data === "") return null;
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetOf(part));
  } catch {
    // A character set this machine doesn't know.
    decoder = new TextDecoder();
  }
  return decoder.decode(Buffer.from(data, "base64url")).slice(0, GMAIL_LIMITS.htmlCharsMost);
}

// Looks through a part and the parts inside it for the first plain text and the first HTML. Parts
// past the limits aren't looked at.
function look(part: unknown, depth: number, found: Found): void {
  if (!isObject(part) || depth > GMAIL_LIMITS.partsDepthMost) return;
  if (found.seen >= GMAIL_LIMITS.partsMost) return;
  found.seen += 1;
  // A part with a file name is an attachment, whatever type it says it is, with all inside it.
  if (typeof part.filename === "string" && part.filename !== "") return;
  const type = typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "";
  if (type === "text/plain") found.plain ??= textOf(part);
  if (type === "text/html") found.html ??= textOf(part);
  if (!Array.isArray(part.parts)) return;
  for (const inner of part.parts) look(inner, depth + 1, found);
}

// The body of a message fetched in full: its plain text, or its HTML as written (`html`, for
// ./text.ts to turn into words). Many companies send a plain part that is only a stub ("View this
// email in your browser"), so a plain part that is short or holds no digit gives way to the HTML.
// Null when there is no text to read.
export function rawBody(raw: unknown): { text: string; html: boolean } | null {
  if (!isObject(raw)) return null;
  const found: Found = { plain: null, html: null, seen: 0 };
  look(raw.payload, 0, found);
  const { plain, html } = found;
  const thin =
    plain === null || plain.trim().length < GMAIL_LIMITS.plainPartShortChars || !/\d/.test(plain);
  if (html !== null && thin) return { text: html, html: true };
  return plain === null ? null : { text: plain, html: false };
}
