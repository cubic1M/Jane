import { COMMON_FIRST_NAMES } from "@/config/person-names";

// People's names stay out of what Jane sends Claude (roadmap research round 11: Plaid's terms and
// the consent screen). Merchant text from a payment app names a person, the payee or the payer:
// "ZELLE TO DANIEL SMITH", "VENMO PAYMENT 1023456789 EMILY ROSE". Claude needs the amount, the day
// and that it went to someone, never who. Every request to Claude goes through redactPersonPayees
// (claudeFetch in src/lib/anthropic.ts); the categorizer and the subscription check also leave out a
// payee that looks like a person (looksLikePersonPayee), since a bare name has no app to mark it.

export const PERSON = "[a person]";

// A payment app, then words like "payment" or "to", then maybe a reference, then the name.
const P2P = new RegExp(
  [
    String.raw`\b(zelle|venmo|cash[ \t]?app|square[ \t]+cash|sq[ \t]*\*[ \t]*cash|apple[ \t]+cash)`,
    String.raw`((?:[ \t*]+(?:payment|pmt|transfer|xfer|instant|sent|received|recurring|online|mobile|money|cashout))*)`,
    String.raw`((?:[ \t]+(?:to|from))|[ \t]*\*)?`,
    String.raw`((?:[ \t:#*-]+(?:conf(?:irmation)?|ref|id)?[ \t#:]*[a-z]{0,3}\d[\w-]*)*)`,
    String.raw`((?:[ \t*]*[a-z][\w'.&,-]*)(?:[ \t*]+[a-z][\w'.&,-]*){0,3})`,
  ].join(""),
  "gi",
);

// Words that end a name: a reference, a day, or ordinary words around one.
const NOT_A_NAME = new Set(
  "TO FROM FOR ON CONF CONFIRMATION REF ID AND OR THE OF IN AT VIA BY APP PAYMENT TRANSFER".split(
    " ",
  ),
);

// Text that may hold a person's name in a form this file knows.
const MAY_NAME = /zelle|venmo|cash|paypal|indn:|transfer|xfer|payment|pmt/i;

// The text with people's names replaced by PERSON: after a payment app, after PayPal's "*" when
// what follows is a person, and Bank of America's LAST,FIRST forms.
export function redactPersonPayees(text: string): string {
  if (!MAY_NAME.test(text)) return text;
  return redactLastFirst(redactPayPal(redactAppPayees(text)));
}

// The names after a payment app. Prose about the apps ("Venmo, Zelle or Cash App") is left alone: a
// name starts with a capital, after "to", "from", "*" or "payment".
function redactAppPayees(text: string): string {
  return text.replace(
    P2P,
    (match, _app, filler: string, direction: string | undefined, _ids, name: string) => {
      if (!filler && !direction) return match;
      const words = name.split(/[ \t*]+/).filter(Boolean);
      let count = 0;
      while (
        count < words.length &&
        /^[A-Z]/.test(words[count]!) &&
        !NOT_A_NAME.has(words[count]!.replace(/[^A-Za-z]/g, "").toUpperCase())
      ) {
        count += 1;
      }
      if (count === 0) return match;
      // Keep what came before the name, and whatever followed it.
      const head = match.slice(0, match.length - name.length);
      const nameStart = name.indexOf(words[0]!);
      const kept = words.slice(count);
      return `${head}${name.slice(0, nameStart)}${PERSON}${kept.length ? ` ${kept.join(" ")}` : ""}`;
    },
  );
}

// PayPal is a merchant's processor as often as a payment app ("PAYPAL *NETFLIX"), so only what
// looks like a person after its "*" is redacted ("PAYPAL *JANE DOE").
const PAYPAL = /\bpaypal[ \t]*\*[ \t]*([a-z][a-z'.-]*(?:[ \t]+[a-z][a-z'.-]*){1,2})/gi;

function redactPayPal(text: string): string {
  return text.replace(PAYPAL, (match, tail: string) =>
    personName(tail) ? match.slice(0, match.length - tail.length) + PERSON : match,
  );
}

// Bank of America's forms, last name first: an ACH line's "INDN:LEE,JORDAN" (the individual it's
// for, usually the account holder) and "Online Banking transfer to LEE,JORDAN". No space at the
// comma, as the bank writes it, so prose ("a payment to Chase, then") isn't touched.
const INDN =
  /\bINDN:[ \t]*([^:\n"]*?)(?=[ \t]+CO[ \t]*ID\b|[ \t]+[A-Z]{2,}[ \t]?:|[ \t]{2,}|[\n"]|$)/gi;
const TO_LAST_FIRST =
  /\b(?:transfer|xfer|payment|pmt)[ \t]+(?:to|from)[ \t]+([a-z][a-z'-]*,[a-z][a-z'-]*(?:[ \t]+[a-z]\b\.?)?)/gi;

function redactLastFirst(text: string): string {
  return text
    .replace(INDN, (match, name: string) =>
      /[a-z]/i.test(name) ? match.slice(0, match.length - name.length) + PERSON : match,
    )
    .replace(TO_LAST_FIRST, (match, name: string) => {
      const [last, first] = name.split(",").map((part) => part.trim());
      const capitalized = (word = "") => /^[A-Z]/.test(word);
      return capitalized(last) && capitalized(first)
        ? match.slice(0, match.length - name.length) + PERSON
        : match;
    });
}

// Whether merchant text names a payment app at all, so it's a transfer to or from someone.
export const viaPaymentApp = (text: string): boolean =>
  /\b(zelle|venmo|cash[ \t]?app|square[ \t]+cash|sq[ \t]*\*[ \t]*cash|apple[ \t]+cash)\b/i.test(
    text,
  );

const BUSINESS = new Set(
  `INC LLC LLP LTD CO CORP CORPORATION COMPANY PC PLLC PA DDS DMD MD DO CPA LAW GROUP SERVICES
  SERVICE SHOP STORE MARKET CAFE GRILL PIZZA BAR KITCHEN SALON SPA CLINIC DENTAL HOSPITAL CENTER
  AUTO MOTORS INSURANCE BANK REALTY HOMES FARM BAKERY DELI FITNESS STUDIO`
    .split(/\s+/)
    .filter(Boolean),
);

// A payee that is probably a person: a payment app's line, or two or three words with a common
// first name first and no business word ("DANIEL SMITH", "Emily R Rose"). Errs toward a person:
// a business kept out only misses Claude's category.
export function looksLikePersonPayee(text: string): boolean {
  if (viaPaymentApp(text)) return true;
  if (redactPersonPayees(text) !== text) return true;
  return personName(text);
}

// Two or three words, a common first name first, no business word and no digits.
function personName(text: string): boolean {
  const words = text
    .toUpperCase()
    .replace(/[^A-Z' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2 || words.length > 3 || /\d/.test(text)) return false;
  if (words.some((word) => BUSINESS.has(word))) return false;
  const last = words[words.length - 1]!;
  return COMMON_FIRST_NAMES.has(words[0]!) && last.length > 1;
}

// Initials for a person the chat must still tell apart ("Daniel Smith" -> "D. S."): enough to say
// which loan, without the name.
export function initialsOf(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z]/g, "")[0])
    .filter(Boolean)
    .slice(0, 3)
    .map((letter) => `${letter!.toUpperCase()}.`);
  return initials.length ? initials.join(" ") : "someone";
}

// Every string in a JSON value with redactPersonPayees applied, except base64 file data.
export function redactJson(value: unknown, key?: string): unknown {
  if (typeof value === "string") return key === "data" ? value : redactPersonPayees(value);
  if (Array.isArray(value)) return value.map((item) => redactJson(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactJson(v, k)] as const),
    );
  }
  return value;
}

// A request body for Claude with people's names taken out; the same string when there were none.
export function redactRequestBody(body: string): string {
  if (!MAY_NAME.test(body)) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return redactPersonPayees(body);
  }
  return JSON.stringify(redactJson(parsed));
}
