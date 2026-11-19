import { GMAIL_LIMITS, PERSONAL_MAIL_DOMAINS, SKIPPED_LABELS } from "@/config/gmail";
import { fromDomain, verifiedSender, type MailMeta } from "./message";

// Which emails Jane reads, decided from who sent one, its subject and its first line or two, before
// any body is fetched and before Claude is asked anything. Pure: rules only, no call. An email kept
// here is one a company wrote that looks like it's about money. The check is rough on purpose: an
// email it keeps that isn't about money costs one reading that keeps nothing, and one it drops is
// never read at all.

type Skipped = "label" | "unverified" | "personal" | "security" | "no_money";

type Screened = { keep: true; senderDomain: string } | { keep: false; why: Skipped };

// A subject that is a way into an account: a sign-in code, a password reset, a sign-in link, or a
// request to confirm an email address. Each is a phrase or a code's own name, never a word a bill
// could use: "Sign in to pay your bill" and a flight's "Confirmation code: X7TQ2" are money emails
// and match none of them.
const SECURITY_SUBJECT: readonly RegExp[] = [
  /\b(?:verification|security|authentication|(?:log|sign)[- ]?in|one[- ]?time|access|2fa|two-factor|two-step) (?:pass)?code\b/,
  /\b(?:passcode|otp|one[- ]?time (?:password|passcode|pin))\b/,
  /\bcode to (?:sign|log) in\b/,
  /\b\d{4,8} is your\b[^.!?]{0,40}\bcode\b/,
  /\b(?:two-factor|two-step|2-step) (?:verification|authentication)\b/,
  /\b(?:reset|forgot|change|create|set) (?:your |a |my |the )?(?:new )?password\b/,
  /\bpassword (?:was |has been )?(?:reset|change|changed|updated|assistance|recovery)\b/,
  /\b(?:temporary|new) password\b/,
  /\b(?:(?:log|sign)[- ]?in|magic) link\b/,
  /\blink to (?:sign|log) in\b/,
  /\b(?:confirm|verify|activate) (?:your |my |this )?(?:new )?(?:e-?mail|account|subscription)\b/,
  /\be-?mail (?:verification|confirmation)\b/,
];

// A dollar amount, or a word a company uses when it writes about money. Stems where the endings
// vary ("renews", "renewal", "refunded"), whole phrases where the word alone is an everyday one
// ("your order", "due date", "free trial": never "order", "due" or "trial" by itself).
const MONEY_SIGNS: readonly RegExp[] = [
  /\$ ?\d|\busd ?\d|\d ?(?:usd|dollars)\b/,
  /\breceipts?\b|\binvoic(?:e|es|ed|ing)\b|\brefund[a-z]{0,5}\b|\bstatements?\b/,
  /\bbill(?:s|ed|ing)?\b|\bpayments?\b|\bpaid\b|\bcharged\b|\bauto[- ]?pay\b/,
  /\bsubscriptions?\b|\brenew[a-z]{0,5}\b|\bpremiums?\b|\bpric(?:e|es|ing)\b|\bpurchas(?:e|es|ed)\b/,
  /\byour order\b|\border confirmation\b|\border #/,
  /\bamount due\b|\bpayment due\b|\bpast due\b|\bdue date\b|\bfree trial\b|\btrial ends\b/,
];

// A subject or the first lines as the patterns above read them: cut first (both to the length a
// subject is read to), lowered, with every run of spaces a single one.
const read = (text: string): string =>
  text.slice(0, GMAIL_LIMITS.subjectChars).toLowerCase().replace(/\s+/g, " ");

// The rules, in order; the first that applies decides. The reasons are for counts and tests, and are
// never stored. Only what Gmail's metadata holds is read here: no body has been fetched yet.
export function screenMail(meta: MailMeta): Screened {
  // 1. Spam, the trash, what the person wrote themselves, chats and the advertising tabs.
  if (meta.labelIds.some((label) => SKIPPED_LABELS.has(label)))
    return { keep: false, why: "label" };
  // 2. Google has to vouch for who sent it (./message.ts).
  const senderDomain = verifiedSender(meta);
  if (senderDomain === null) return { keep: false, why: "unverified" };
  // 3. A person writing, not a company. The whole domain, exactly: comcast.net is where people
  //    have mailboxes, and alerts.comcast.net is where its bills come from.
  if (PERSONAL_MAIL_DOMAINS.has(fromDomain(meta) ?? "")) return { keep: false, why: "personal" };
  // 4. A way into an account is never read, whatever else the email says.
  const subject = read(meta.subject);
  if (SECURITY_SUBJECT.some((phrase) => phrase.test(subject))) {
    return { keep: false, why: "security" };
  }
  // 5. Nothing in the subject or the first lines says money.
  const start = `${subject}\n${read(meta.snippet)}`;
  if (!MONEY_SIGNS.some((sign) => sign.test(start))) return { keep: false, why: "no_money" };
  return { keep: true, senderDomain };
}
