import { GMAIL_LIMITS } from "@/config/gmail";

// An email's words, made ready for the reader: HTML turned into text, what Claude may see of it,
// and whether it gives away a code or a password. Pure. Every function here runs over text an
// email's sender wrote, at the length they chose, so each cuts the text (or refuses it) first and
// then reads it in one pass: a pattern below is a run of one kind of character or has a fixed
// length, and none can be made to start over from every position (./text.test.ts times crafted
// input, as src/lib/connectors/tax-upload-crafted-text.test.ts does). Nothing here keeps or logs
// what it reads.

const GREATER_THAN = 62;
const SLASH = 47;
const BANG = 33;
const QUESTION = 63;
const EQUALS = 61;
const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;
const SPACE = 32;

const isLetter = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isDigit = (code: number): boolean => code >= 48 && code <= 57;

// Tags that end a line where they stand: blocks, list items and table cells. Any other tag is a
// space, so the words on either side of it never join.
const BREAKS = new Set(
  "address article aside blockquote br caption center dd div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol option p pre section table tbody td tfoot th thead title tr ul".split(
    " ",
  ),
);
// Tags whose contents aren't words to read.
const DROPPED = new Set(["script", "style"]);

// Where a tag ends: the first ">" that isn't inside a quoted attribute value. -1 when it never
// ends.
function tagEnd(source: string, from: number): number {
  let quote = 0;
  let before = 0;
  for (let i = from; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (quote !== 0) {
      if (code === quote) quote = 0;
    } else if ((code === DOUBLE_QUOTE || code === SINGLE_QUOTE) && before === EQUALS) {
      quote = code;
    } else if (code === GREATER_THAN) {
      return i;
    }
    if (code > SPACE) before = code;
  }
  return -1;
}

// A tag's name, lowered, with the "/" of a closing tag: "p", "/td", "br". Empty for "<!doctype".
function tagName(source: string, from: number, to: number): string {
  let end = source.charCodeAt(from) === SLASH ? from + 1 : from;
  while (end < to && (isLetter(source.charCodeAt(end)) || isDigit(source.charCodeAt(end)))) end++;
  return source.slice(from, end).toLowerCase();
}

// Where reading carries on after a script or a style: past its closing tag, or at the end when
// there is none.
function afterClosing(source: string, name: string, from: number): number {
  for (let at = from; ;) {
    const close = source.indexOf("</", at);
    if (close === -1) return source.length;
    if (source.slice(close + 2, close + 2 + name.length).toLowerCase() === name) {
      const end = source.indexOf(">", close);
      return end === -1 ? source.length : end + 1;
    }
    at = close + 2;
  }
}

const ENTITIES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ensp: " ",
    emsp: " ",
    thinsp: " ",
    dollar: "$",
    cent: "¢",
    pound: "£",
    euro: "€",
    yen: "¥",
    copy: "©",
    reg: "®",
    trade: "™",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    bull: "•",
    middot: "·",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    laquo: "«",
    raquo: "»",
    times: "×",
    deg: "°",
    // Written to show as nothing.
    zwnj: "",
    zwj: "",
    shy: "",
    lrm: "",
    rlm: "",
  }),
);

// "&amp;", "&#36;" and "&#x24;": each a fixed, short shape.
const ENTITY = /&(#[0-9]{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi;

// A character a number may name: not a control, and not half of a pair.
const printable = (code: number): boolean =>
  code === 9 ||
  code === 10 ||
  code === 13 ||
  (code >= 32 && code < 127) ||
  (code > 159 && code < 0xd800) ||
  (code > 0xdfff && code <= 0x10ffff);

// Every entity in one pass, so "&amp;lt;" is "&lt;" as written and never "<".
function decoded(text: string): string {
  return text.replace(ENTITY, (whole: string, name: string) => {
    if (!name.startsWith("#")) return ENTITIES.get(name.toLowerCase()) ?? whole;
    const hex = name[1] === "x" || name[1] === "X";
    const code = hex ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return printable(code) ? String.fromCodePoint(code) : " ";
  });
}

// An HTML body as plain words. The text is cut to what is ever looked at, then read once from
// start to end: a tag becomes a space, the end of a block or a table cell a line break, a script
// or a style is left out with all inside it, and entities become their characters. A tag that
// never closes takes the rest with it, as it does in a browser. Nothing is shown from this: it is
// what the reader is given, after forReader below.
export function htmlToText(html: string): string {
  const source = html.slice(0, GMAIL_LIMITS.htmlCharsMost);
  const parts: string[] = [];
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf("<", at);
    if (open === -1) {
      parts.push(source.slice(at));
      break;
    }
    parts.push(source.slice(at, open));
    if (source.startsWith("<!--", open)) {
      const close = source.indexOf("-->", open + 4);
      at = close === -1 ? source.length : close + 3;
      parts.push(" ");
      continue;
    }
    const next = source.charCodeAt(open + 1);
    if (!isLetter(next) && next !== SLASH && next !== BANG && next !== QUESTION) {
      // "5 < 6" is words, not the start of a tag.
      parts.push("<");
      at = open + 1;
      continue;
    }
    const end = tagEnd(source, open + 1);
    if (end === -1) break;
    const name = tagName(source, open + 1, end);
    at = DROPPED.has(name) ? afterClosing(source, name, end + 1) : end + 1;
    parts.push(BREAKS.has(name.replace("/", "")) ? "\n" : " ");
  }
  return decoded(parts.join(""))
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n[ \n]*/g, "\n")
    .trim();
}

// Every kind of space and line break Unicode has, other than a plain space and a line feed.
const SPACES = /[\t\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g;
// Characters that show as nothing or turn the text around, and controls. Email puts them between
// digits to stop a phone making a link of a number: with them gone, a card number written that way
// is one long number again, and is masked like any other.
const INVISIBLE =
  /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff]/g;
// A web address, or anything else written as "scheme://", wherever it starts: one that runs on from
// the word or the number before it ("Order 4521https://...") is a link all the same. A scheme is
// short, so what is tried at each letter has a fixed length, however long the word it stands in.
// It runs to the next space, "<", ">" or double quote: an apostrophe can be part of an address, and
// what comes after one ("?name=O'Brien&token=...") must go with the rest.
const LINK = /[a-z][a-z0-9+.-]{1,20}:\/\/[^\s<>"]+|(?<![a-z])www\.[^\s<>"]+/gi;
// An account or card number: groups of four as a card prints them, four groups or more, or digits
// in a long row. Either takes the decimals written after it ("000123456789.00"), so that no part of
// one is left to be read as an amount. After a card those are cents only ("...1111.00"), so a card
// written right after another ("...1111,4222 2222 2222 2222") is replaced whole as well.
const LONG_NUMBER = new RegExp(
  `(?<!\\d)\\d{4}(?:[ -]\\d{4}){3,}(?!\\d)(?:[.,]\\d{1,2}(?!\\d))?|\\d{${GMAIL_LIMITS.longNumberDigits},}(?:[.,]\\d+)*`,
  "g",
);

// Whether a run of characters between spaces holds an email address: a name, an "@", and a host
// with a dot in it.
function addressShaped(token: string): boolean {
  const at = token.indexOf("@", 1);
  return at !== -1 && token.indexOf(".", at + 2) !== -1;
}

// The replacements every text gets before Claude may see it. No digit of a masked number is kept,
// so no part of one can pass for an amount. A date ("2026-11-18") and an amount ("$1,234.56") go
// through as written.
function masked(text: string): string {
  return text
    .slice(0, GMAIL_LIMITS.htmlCharsMost)
    .replace(SPACES, " ")
    .replace(INVISIBLE, "")
    .replace(LINK, "[link]")
    .replace(/\S+/g, (token) => (addressShaped(token) ? "[address]" : token))
    .replace(LONG_NUMBER, "[number]");
}

// The start of a text up to a limit, ending between two words where it can: half a figure would
// read as another figure.
function startOf(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  return end > 0 ? cut.slice(0, end) : cut;
}

// The end of a text, the same way.
function endOf(text: string, limit: number): string {
  const cut = text.slice(-limit);
  const start = cut.search(/\s/);
  return start === -1 ? cut : cut.slice(start + 1);
}

// An email's body as Claude may see it: links, addresses and long numbers replaced by "[link]",
// "[address]" and "[number]", then the start and the end of it with "[...]" between when the
// middle was left out. A receipt's total comes after its items, so the end is kept.
export function forReader(text: string): string {
  const all = masked(text);
  const { bodyHeadChars, bodyTailChars } = GMAIL_LIMITS;
  const seen =
    all.length <= bodyHeadChars + bodyTailChars
      ? all
      : `${startOf(all, bodyHeadChars)}\n[...]\n${endOf(all, bodyTailChars)}`;
  // A cut, or the email itself, can leave half of a two-part character, which no request may carry.
  return seen.toWellFormed();
}

// A subject, through the same replacements: on one line, and no longer than a subject is read.
export function subjectForReader(subject: string): string {
  const line = masked(subject).replace(/\s+/g, " ").trim();
  return startOf(line, GMAIL_LIMITS.subjectChars).toWellFormed();
}

// How far from the word "code" its digits, and the words that make it a secret, are looked for:
// longer than anything the patterns below can match, so none of them ends at the edge.
const NEAR = 100;

// A code, by any of its names.
const CODE_WORD = /(?<![a-z0-9])(?:(?:pass)?codes?|pin|otp)(?![a-z0-9])/g;
// What a receipt, a booking or an offer calls a code: none of these signs anyone in.
const EVERYDAY_CODES = new Set(
  "confirmation promo promotional zip postal order booking discount area coupon".split(" "),
);
// The words that make a code a secret. "Sign in", "signing in", "one time" and the like are joined
// with a hyphen before these are looked for.
const SECURITY =
  "verif[a-z]{1,10}|authenticat[a-z]{1,5}|security|log-?in|sign-?in|one-?time|access|2fa|two-factor|two-step";
// One of them, or a code's own name: "PIN code", "OTP code".
const SECURITY_WORD = new RegExp(`^(?:${SECURITY}|otp|passcode|pin)$`);
// "code to sign in", "code for two-step verification".
const SECURITY_AFTER = new RegExp(
  `^ (?:to|for)(?: [a-z'\u2019-]{1,15}){0,3} (?:${SECURITY})(?![a-z0-9])`,
);
// The digits of a code: four to eight on their own, or six written "482 913" or "482-913". Never
// part of a longer number, an amount or a date.
const CODE_DIGITS = `(?<![\\w$])(?<!\\d[.,/:-])(?:\\d{${GMAIL_LIMITS.codeDigitsLeast},${GMAIL_LIMITS.codeDigitsMost}}|\\d{3}[ -]\\d{3})(?![\\w]|[.,/:-]\\d)`;
// The digits come right after the code's name, or after "is", a colon, a dash or the end of its
// sentence, with any words or figures of that sentence between: "Your code is 482913", "code to
// sign in: 482913", "Your code (valid for 10 minutes) is 482913", "Your code is below. 482913".
// Digits that only follow other words don't count ("use your PIN at any of our 4000 ATMs").
const THEN_DIGITS = new RegExp(
  `^(?:(?:[^.!?]|\\.(?=\\d)){0,60}(?:\\bis|[:=.!]| [-\u2013\u2014]))? ?["'*(\\[]{0,2}(?:[a-z]{1,3}-)?${CODE_DIGITS}`,
);
// "482913 is your Acme verification code."
const DIGITS_FIRST = new RegExp(
  `${CODE_DIGITS} is your (?:[^ .!?]{1,20} ){0,3}(?:(?:${SECURITY}) (?:pass)?code|passcode|pin|otp)(?![a-z0-9])`,
);
// A password given in the email itself. One that is only mentioned ("never share your password")
// is not.
const GIVES_PASSWORD = /\btemporary password\b|\byour (?:new |temporary )?password is\b/;

// Whether the word found is a code that signs someone in: a passcode, a PIN or an OTP by name, or
// a "code" with a security word in the three words before it, or after "to" or "for", whether that
// comes right after the word or after its digits ("code 482913 to sign in"). A zip code, a promo
// code and a confirmation code are not.
function isSecret(word: string, before: string, after: string, afterDigits: string): boolean {
  if (word !== "code" && word !== "codes") return true;
  const lead = before
    .split(" ")
    .map((w) => w.replace(/^[^a-z0-9]{0,3}/, "").replace(/[^a-z0-9]{0,3}$/, ""))
    .filter(Boolean)
    .slice(-3);
  if (EVERYDAY_CODES.has(lead[lead.length - 1])) return false;
  return (
    lead.some((w) => SECURITY_WORD.test(w)) ||
    SECURITY_AFTER.test(after) ||
    SECURITY_AFTER.test(afterDigits)
  );
}

// Whether a text gives a code or a password that signs someone in: an email carrying one is never
// sent to Claude. Run over everything that would be sent. A text that only mentions codes or
// passwords, as the foot of a bank's email does, carries none.
export function carriesSecret(text: string): boolean {
  // Far longer than anything Jane sends: not looked through, so not to be sent either.
  if (text.length > GMAIL_LIMITS.htmlCharsMost) return true;
  const said = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(sign|log)(?:g?ing)? in\b/g, "$1-in")
    .replace(/\bone time\b/g, "one-time")
    .replace(/\btwo (factor|step)\b/g, "two-$1")
    // A one-time password is a code by another name.
    .replace(/\bone-time password\b/g, "one-time passcode");
  if (GIVES_PASSWORD.test(said) || DIGITS_FIRST.test(said)) return true;
  for (const found of said.matchAll(CODE_WORD)) {
    const end = found.index + found[0].length;
    const after = said.slice(end, end + NEAR);
    const digits = THEN_DIGITS.exec(after);
    if (!digits) continue;
    const before = said.slice(Math.max(0, found.index - NEAR), found.index);
    const past = end + digits[0].length;
    if (isSecret(found[0], before, after, said.slice(past, past + NEAR))) return true;
  }
  return false;
}
