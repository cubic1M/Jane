import { SHARED_MAIL_DOMAINS } from "./agent";
import { killed } from "./kill-switches";

// Read-only Gmail mailboxes (docs/setup/gmail.md): a person connects one or more, and Jane lists
// the money emails it reads in them. Off unless GMAIL_LINK is exactly "1": no Connect link, the
// connect, callback and webhook routes answer 404, and nothing is read. Names, addresses and limits
// only: nothing here calls Google or Claude.

export const gmailOffered = (): boolean => process.env.GMAIL_LINK?.trim() === "1";

// KILL_BANKS (docs/incident.md) stops reading and new connections. Disconnecting keeps working.
export const gmailOpen = (): boolean => gmailOffered() && !killed("banks");

// Whether Google sends notices, or mailboxes are read once a day.
export const gmailNoticesOn = (): boolean => Boolean(process.env.GMAIL_PUBSUB_TOPIC?.trim());

// The one permission asked for: read-only. Asked for alone, so Google shows no box to untick.
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// Registered with Google as the way back: keep this path, or every connection must start again.
export const GMAIL_CALLBACK_PATH = "/api/gmail/callback";
// The page mailboxes are connected, listed and disconnected on.
export const GMAIL_PAGE_PATH = "/settings/mailboxes";

// Google's own addresses.
const OFFICIAL = {
  // Where the person signs in: the browser is sent there, and Jane never fetches it.
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://gmail.googleapis.com/gmail/v1/users/me",
  // The keys Google signs its notices with.
  certs: "https://www.googleapis.com/oauth2/v3/certs",
} as const;

// The hosts Jane's own calls go to, at any path. Exact names, never a suffix: other hosts under
// googleapis.com serve files anyone can put there.
const GOOGLE_HOSTS = new Set(["oauth2.googleapis.com", "gmail.googleapis.com"]);
// The keys are on www.googleapis.com, the front door to many of Google's products. Cloud Storage
// answers there too, so on that host only the keys' own path is called.
const KEYS = new URL(OFFICIAL.certs);

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function localOverride(env: Record<string, string | undefined>): URL | null {
  // Never in production, whatever the setting says.
  if (env.VERCEL_ENV === "production") return null;
  const raw = env.GMAIL_API_URL?.trim();
  if (!raw || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  const web = url.protocol === "http:" || url.protocol === "https:";
  return web && LOOPBACK.has(url.hostname) ? url : null;
}

// Google's servers. GMAIL_API_URL replaces them only with one on this machine, for the fake Google
// in the tests, which then answers at each address's own path. An address anywhere else is ignored,
// so a setting can't send a person's tokens or mail to another company.
export function googleServer(
  env: Record<string, string | undefined> = process.env,
): Record<keyof typeof OFFICIAL, string> {
  const local = localOverride(env);
  if (!local) return { ...OFFICIAL };
  const here = (address: string) => `${local.origin}${new URL(address).pathname}`;
  return {
    authorize: here(OFFICIAL.authorize),
    token: here(OFFICIAL.token),
    revoke: here(OFFICIAL.revoke),
    api: here(OFFICIAL.api),
    certs: here(OFFICIAL.certs),
  };
}

// Whether an address is one Jane may call: https, on exactly one of the hosts a person's tokens go
// to, or on the keys' host at the keys' own path. With the fake Google on this machine, only that
// server's own address.
export function googleAddressAllowed(
  address: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!URL.canParse(address)) return false;
  const url = new URL(address);
  // A name before the host is how an address is made to read as somewhere it doesn't go.
  if (url.username || url.password) return false;
  const local = localOverride(env);
  if (local) return url.origin === local.origin;
  if (url.protocol !== "https:" || url.port !== "") return false;
  if (url.hostname === KEYS.hostname) return url.pathname === KEYS.pathname;
  return GOOGLE_HOSTS.has(url.hostname);
}

// What a money email can be: the kind saved on each reading.
export const GMAIL_KINDS = ["receipt", "bill", "renewal", "price_change", "refund"] as const;
export type GmailKind = (typeof GMAIL_KINDS)[number];

// A small model: it reads one short email into three fields. ANTHROPIC_GMAIL_MODEL names another,
// used only when it is a model with a listed price (MODEL_PRICES_CENTS in ./answer-checks.ts).
export const GMAIL_READER_MODEL = "claude-haiku-5-5";
// Mail stops asking Claude once the month's spend for everything passes this share of the cap,
// so reading mail can never use up what the chat needs.
export const GMAIL_MONTH_SHARE = 0.5;
// Whether Google has checked the app. Until then its sign-in page shows a warning, and the
// page says so before the person goes there (a bullet in ./gmail-disclosure.ts, so its version
// changes when this does).
export const GMAIL_APP_VERIFIED = false;

export const GMAIL_LIMITS = {
  // One try of a request to Google, its answer read to the end. Short: when a read's time is up,
  // the email it is still in can be waiting on several of these.
  callTimeoutMs: 8_000,
  // More tries a request gets after a 429, a 5xx or no answer, with a short wait between.
  callRetries: 2,
  // That wait before the second try; it grows with each try after.
  callRetryWaitMs: 300,
  // The most taken from one of Google's answers; a larger one isn't used.
  answerBytes: 2_000_000,
  // The same for the sign-in addresses, whose answers are a few short fields.
  signInAnswerBytes: 100_000,
  // An access token this close to its end is renewed before a read uses it.
  tokenMarginSeconds: 60,
  // How long a sign-in at Google may take, there and back.
  signInMinutes: 10,
  // How long the Connect link on the mailboxes page stays good.
  ticketMinutes: 60,
  // How long the page may show what just happened (connected, disconnected, refused).
  noticeSeconds: 60,
  // The largest notice from Google the webhook takes.
  webhookBytes: 64 * 1024,
  // Mailboxes one person may connect.
  mailboxesMost: 5,
  // Everything one notice or one connect starts, counted from when its request arrived: the route's
  // own calls come out of it.
  runBudgetMs: 150_000,
  // Emails one read asks Google for before it stops; the next read carries on from there.
  runMessages: 60,
  // One mailbox in the daily job: it gets the smaller of this and what is left of the run. A mailbox
  // never read through gets a whole read's runBudgetMs instead, and once another mailbox has started
  // it waits for the next run when less than that is left. One whose last read was unfinished gets a
  // whole read when one fits, and this otherwise, never put off for want of one.
  nightMailboxBudgetMs: 20_000,
  // One run of the daily job; mailboxes it doesn't reach wait for the next. Set so that the last
  // read, the calls it is still waiting on and the job's own end inside the function's five
  // minutes, with time to spare. Never less than runBudgetMs, so the run's first mailbox can always
  // have a whole read.
  cronBudgetMs: 165_000,
  // Mailboxes the daily job takes on in one run.
  cronMailboxes: 500,
  // A mailbox checked more recently than this waits for tomorrow's job.
  staleHours: 20,
  // A read older than this was lost to a crash, so another may start. Longer than a function runs.
  lockMinutes: 10,
  // Google's notices for a mailbox end after a week: a read asks again once the end is this near.
  watchRenewHours: 6 * 24,
  // A failed read waits this long before the next try, doubling each time.
  backoffMinutes: 5,
  // The longest a failed read waits.
  backoffMostHours: 12,
  // The most Claude may write back about one email.
  readerMaxTokens: 2_000,
  // One request to Claude, for one email: how long its answer may take to begin. One that doesn't
  // begin in time is that email's own trouble, and it is skipped.
  readerTimeoutMs: 20_000,
  // The most that request may take in all, its answer read to the end: past this it is let go, and
  // the email is read later. A little over readerTimeoutMs, so an answer that didn't begin in time
  // is still that email's own trouble.
  readerMostMs: 22_000,
  // A read that stopped because Claude couldn't be asked tries again after this.
  readerRetryMinutes: 30,
  // Emails in a row Claude wouldn't read before the read stops as if Claude were down.
  readerRefusalsInARow: 3,
  // How far back the look over recent mail goes when a mailbox is connected, or after a gap.
  lookBackDays: 14,
  // The most emails that look back reads.
  lookBackMessages: 30,
  // A larger email, by Gmail's own estimate, is skipped.
  mailBytesMost: 1_500_000,
  // An email Gmail says arrived more than this after the read began has no time Jane can use.
  receivedAheadHours: 24,
  // An email's text, plain or HTML, is cut to this before any pattern runs over it.
  htmlCharsMost: 200_000,
  // A From or Authentication-Results header longer than this isn't cut: the email is unverified.
  headerChars: 4_000,
  // How deep parts inside parts are followed when an email's body is looked for.
  partsDepthMost: 8,
  // The most parts of one email that are looked at.
  partsMost: 60,
  // A plain-text part shorter than this gives way to the HTML part, when there is one.
  plainPartShortChars: 200,
  // What Claude gets from the start of an email's body.
  bodyHeadChars: 2_500,
  // What Claude gets from the end of it, where a total usually is.
  bodyTailChars: 1_500,
  // The most of a subject that is looked at or sent to Claude.
  subjectChars: 300,
  // This many digits in a row or more (an account or card number) never reach Claude.
  longNumberDigits: 9,
  // A sign-in code has at least this many digits; an email carrying one is never sent to Claude.
  codeDigitsLeast: 4,
  // And this many at most.
  codeDigitsMost: 8,
  // The part of a sender's domain that is saved and shown: a longer one isn't taken as checked.
  shownDomainChars: 40,
  // An amount Claude gives is kept only up to this: $100,000.
  amountMostCents: 10_000_000,
  // A date Claude gives is kept only this many days before the email arrived, at most.
  dateBackDays: 60,
  // And this many days after it, at most.
  dateAheadDays: 400,
  // How long Google's signing keys are kept before they're fetched again.
  keysHours: 1,
  // A notice naming a key Jane doesn't hold causes a fetch at most this often.
  keysRefetchSeconds: 60,
  // How far Google's clock and Jane's may differ when a notice's times are checked.
  clockSkewSeconds: 60,
  // Money emails listed on the page, newest first.
  shownReadings: 50,
  // How long the page says emails were missed after reading lost its place.
  missedShownDays: 30,
  // How long after connecting a mailbox not yet read says it's being read, not that it couldn't be.
  firstReadMinutes: 10,
} as const;

// Gmail's labels for mail Jane never looks at: spam, the trash, what the person wrote themselves,
// chats, and the advertising, social and forum tabs.
export const SKIPPED_LABELS: ReadonlySet<string> = new Set([
  "SPAM",
  "TRASH",
  "DRAFT",
  "SENT",
  "CHAT",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
]);

// Mail anyone can sign up for: a person writing, not a company. Matched exactly, never by suffix,
// so a company whose domain only ends like one of these is still a company. The large free services
// and internet providers only: a person's own domain can't be told from a company's.
export const PERSONAL_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  ...SHARED_MAIL_DOMAINS,
  "ymail.com",
  "mac.com",
  "pm.me",
  "gmx.net",
  "mail.com",
  "yandex.com",
  "fastmail.com",
  "hey.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  // Yahoo's older name, and its addresses in other countries.
  "rocketmail.com",
  "yahoo.co.uk",
  "yahoo.ca",
  "yahoo.com.au",
  "yahoo.co.nz",
  "yahoo.co.in",
  "yahoo.in",
  "yahoo.ie",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.it",
  "yahoo.es",
  "yahoo.com.br",
  "yahoo.com.mx",
  "yahoo.com.ar",
  "yahoo.com.sg",
  "yahoo.com.hk",
  "yahoo.com.tw",
  "yahoo.com.ph",
  "yahoo.co.id",
  "yahoo.co.jp",
  // Microsoft's free mail in other countries.
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.it",
  "hotmail.es",
  "hotmail.ca",
  "live.co.uk",
  "live.ca",
  "live.fr",
  "live.com.au",
  "outlook.fr",
  "outlook.de",
  "outlook.es",
  "outlook.it",
  // Large providers in other countries.
  "btinternet.com",
  "gmx.de",
  "web.de",
  "t-online.de",
  "orange.fr",
  "rogers.com",
  "shaw.ca",
  "bigpond.com",
  // And in the US: internet providers' mail, a free service, and DuckDuckGo's forwarding addresses.
  "earthlink.net",
  "optonline.net",
  "frontier.com",
  "windstream.net",
  "juno.com",
  "duck.com",
]);
