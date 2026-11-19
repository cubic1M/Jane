import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHARED_MAIL_DOMAINS } from "./agent";
import { MODEL_PRICES_CENTS } from "./answer-checks";
import {
  GMAIL_CALLBACK_PATH,
  GMAIL_KINDS,
  GMAIL_LIMITS,
  GMAIL_MONTH_SHARE,
  GMAIL_READER_MODEL,
  GMAIL_SCOPE,
  PERSONAL_MAIL_DOMAINS,
  SKIPPED_LABELS,
  gmailNoticesOn,
  gmailOffered,
  gmailOpen,
  googleAddressAllowed,
  googleServer,
} from "./gmail";
import { HEARTBEAT_TIMEOUT_MS, OPS_SWITCH_FIRST_READ_TIMEOUT_MS } from "./health";
import { KILL_SWITCH_VARS, rememberStoredSwitches } from "./kill-switches";
import { KEEP_RATE_LIMIT_PREFIXES, RATE_LIMITS, RATE_LIMIT_RETENTION_HOURS } from "./rate-limits";

// Gmail mailboxes' switches, the addresses a person's tokens may go to, and the lists the reading
// rules stand on (docs/setup/gmail.md).

beforeEach(() => {
  for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rememberStoredSwitches([]);
});

describe("the switch", () => {
  it.each(["", "0", "true", "yes", " 2 ", "on", "11"])("isn't on for %j, only for 1", (value) => {
    vi.stubEnv("GMAIL_LINK", value);
    expect(gmailOffered()).toBe(false);
    expect(gmailOpen()).toBe(false);
  });

  it.each(["1", " 1 "])("is on for %j", (value) => {
    vi.stubEnv("GMAIL_LINK", value);
    expect(gmailOffered()).toBe(true);
    expect(gmailOpen()).toBe(true);
  });

  it("stops at KILL_BANKS, and stays offered so people can still disconnect", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    vi.stubEnv("KILL_BANKS", "1");
    expect(gmailOpen()).toBe(false);
    expect(gmailOffered()).toBe(true);
  });

  it("stops at the banks switch set in the store too", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    rememberStoredSwitches(["banks"]);
    expect(gmailOpen()).toBe(false);
    expect(gmailOffered()).toBe(true);
  });

  it.each(["claude", "uploads", "email", "connectors"])(
    "isn't stopped by the %s switch",
    (name) => {
      vi.stubEnv("GMAIL_LINK", "1");
      rememberStoredSwitches([name]);
      expect(gmailOpen()).toBe(true);
    },
  );

  it("asks Google for notices only when a topic is set", () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("GMAIL_PUBSUB_TOPIC", value);
      expect(gmailNoticesOn(), JSON.stringify(value)).toBe(false);
    }
    vi.stubEnv("GMAIL_PUBSUB_TOPIC", "projects/jane-mail/topics/gmail");
    expect(gmailNoticesOn()).toBe(true);
  });
});

describe("what Jane asks Google for", () => {
  it("is reading, and nothing else", () => {
    expect(GMAIL_SCOPE).toBe("https://www.googleapis.com/auth/gmail.readonly");
  });

  it("comes back to the path registered with Google", () => {
    expect(GMAIL_CALLBACK_PATH).toBe("/api/gmail/callback");
  });
});

describe("Google's addresses", () => {
  const official = (address: string) => googleAddressAllowed(address, {});

  it("are Google's own unless a fake on this machine stands in", () => {
    expect(googleServer({})).toEqual({
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      revoke: "https://oauth2.googleapis.com/revoke",
      api: "https://gmail.googleapis.com/gmail/v1/users/me",
      certs: "https://www.googleapis.com/oauth2/v3/certs",
    });
  });

  it("may all be called, except the sign-in page, which only the browser opens", () => {
    const { authorize, ...called } = googleServer({});
    for (const address of Object.values(called)) expect(official(address), address).toBe(true);
    expect(official(authorize)).toBe(false);
  });

  it("are handed out as a copy, so one caller can't change them for the next", () => {
    googleServer({}).token = "https://evil.example/token";
    expect(googleServer({}).token).toBe("https://oauth2.googleapis.com/token");
  });

  it.each([
    "https://oauth2.googleapis.com/token",
    "https://oauth2.googleapis.com/revoke",
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/18c2?format=full",
    "https://www.googleapis.com/oauth2/v3/certs",
    "HTTPS://GMAIL.GOOGLEAPIS.COM/gmail/v1/users/me/history",
    "HTTPS://WWW.GOOGLEAPIS.COM/oauth2/v3/certs",
  ])("takes Google's own over https: %s", (address) => {
    expect(official(address)).toBe(true);
  });

  // www.googleapis.com is the front door to many of Google's products. Cloud Storage answers there
  // too, with files anyone can publish, and it is where the keys that sign Google's notices live.
  it.each([
    "https://www.googleapis.com/",
    "https://www.googleapis.com/storage/v1/b/a-bucket/o/keys.json?alt=media",
    "https://www.googleapis.com/download/storage/v1/b/a-bucket/o/keys.json?alt=media",
    // Reads as the keys' address, and goes to a file in a bucket.
    "https://www.googleapis.com/oauth2/v3/certs/../../../storage/v1/b/a-bucket/o/keys.json",
    "https://www.googleapis.com/oauth2/v3/certs/..%2F..%2F..%2Fstorage/v1/b/a-bucket/o/keys.json",
    // Near the keys' path, and not it.
    "https://www.googleapis.com/oauth2/v3/certs/",
    "https://www.googleapis.com/oauth2/v3/certs/more",
    "https://www.googleapis.com/oauth2/v3/certsmore",
    "https://www.googleapis.com/oauth2/v1/certs",
    "https://www.googleapis.com/OAUTH2/V3/CERTS",
    "https://www.googleapis.com/storage/v1/b/a-bucket/o/keys.json?/oauth2/v3/certs",
    "https://www.googleapis.com/storage/v1/b/a-bucket/o/keys.json#/oauth2/v3/certs",
    // The permission's own name is on that host too. It is a name, never fetched.
    GMAIL_SCOPE,
  ])("takes nothing on Google's shared host but the keys' own path: not %s", (address) => {
    expect(official(address)).toBe(false);
  });

  it.each([
    // Not https.
    "http://oauth2.googleapis.com/token",
    "http://gmail.googleapis.com/gmail/v1/users/me/profile",
    "http://www.googleapis.com/oauth2/v3/certs",
    "ftp://gmail.googleapis.com/gmail/v1/users/me/profile",
    // A host that only starts with one of Google's names.
    "https://oauth2.googleapis.com.evil.example/token",
    "https://gmail.googleapis.com.evil.example/gmail/v1/users/me/profile",
    "https://www.googleapis.com.evil.example/oauth2/v3/certs",
    "https://gmail.googleapis.com-evil.example/",
    // A host that only ends with one, or is another of Google's (anyone can put a file on storage).
    "https://evilgmail.googleapis.com/gmail/v1/users/me/profile",
    "https://evil.gmail.googleapis.com/gmail/v1/users/me/profile",
    "https://notoauth2.googleapis.com/token",
    "https://storage.googleapis.com/a-bucket/token",
    "https://googleapis.com/token",
    "https://accounts.google.com/o/oauth2/token",
    "https://gmail.googleapis.com./gmail/v1/users/me/profile",
    // A letter that only looks like Google's.
    "https://gma\u0456l.googleapis.com/gmail/v1/users/me/profile",
    // The name where a sign-in name goes, or anywhere but the host.
    "https://gmail.googleapis.com@evil.example/gmail/v1/users/me/profile",
    "https://oauth2.googleapis.com:443@evil.example/token",
    "https://evil.example\\@gmail.googleapis.com/",
    "https://someone@gmail.googleapis.com/gmail/v1/users/me/profile",
    "https://someone:word@oauth2.googleapis.com/token",
    "https://evil.example/gmail.googleapis.com",
    "https://evil.example#.gmail.googleapis.com",
    "https://evil.example?.gmail.googleapis.com",
    // A port of someone's choosing.
    "https://gmail.googleapis.com:8443/gmail/v1/users/me/profile",
    "https://oauth2.googleapis.com:444/token",
    "https://www.googleapis.com:80/oauth2/v3/certs",
    // Not an address on the web at all.
    "javascript:alert(1)//gmail.googleapis.com",
    "file:///etc/passwd",
    "data:text/plain,gmail.googleapis.com",
    "//gmail.googleapis.com/gmail/v1/users/me/profile",
    "gmail.googleapis.com/gmail/v1/users/me/profile",
    "not an address",
    "",
    // This machine, when no fake was named.
    "http://127.0.0.1:4599/token",
    "https://127.0.0.1/token",
    "http://localhost/token",
  ])("refuses %s", (address) => {
    expect(official(address)).toBe(false);
  });
});

describe("a fake Google on this machine", () => {
  const LOCAL = "http://127.0.0.1:4599";

  it("stands in at each address's own path", () => {
    expect(googleServer({ GMAIL_API_URL: LOCAL })).toEqual({
      authorize: `${LOCAL}/o/oauth2/v2/auth`,
      token: `${LOCAL}/token`,
      revoke: `${LOCAL}/revoke`,
      api: `${LOCAL}/gmail/v1/users/me`,
      certs: `${LOCAL}/oauth2/v3/certs`,
    });
  });

  it.each([
    LOCAL,
    `${LOCAL}/`,
    ` ${LOCAL}/anything?x=1 `,
    "http://localhost:4599",
    "http://[::1]:4599",
  ])("is taken at %j, whatever follows the port", (raw) => {
    const env = { GMAIL_API_URL: raw };
    const origin = new URL(raw.trim()).origin;
    expect(googleServer(env).token).toBe(`${origin}/token`);
    expect(googleAddressAllowed(`${origin}/gmail/v1/users/me/profile`, env)).toBe(true);
  });

  it("is then the only address called: not another port, and not Google's", () => {
    const env = { GMAIL_API_URL: LOCAL };
    expect(googleAddressAllowed(`${LOCAL}/token`, env)).toBe(true);
    expect(googleAddressAllowed("http://127.0.0.1:4600/token", env)).toBe(false);
    expect(googleAddressAllowed("https://127.0.0.1:4599/token", env)).toBe(false);
    expect(googleAddressAllowed("http://localhost:4599/token", env)).toBe(false);
    expect(googleAddressAllowed("http://someone@127.0.0.1:4599/token", env)).toBe(false);
    expect(googleAddressAllowed("https://oauth2.googleapis.com/token", env)).toBe(false);
  });

  it.each([
    "https://evil.example/",
    "http://127.0.0.1.evil.example/",
    "http://localhost.evil.example/",
    "http://localhost@evil.example/",
    "http://evil.example/127.0.0.1",
    "http://localhost./",
    "http://0.0.0.0/",
    "http://10.0.0.5:4599/",
    "http://169.254.169.254/",
    "ftp://127.0.0.1/",
    "file://localhost/etc/passwd",
    "not an address",
    "",
  ])("is ignored when the setting points at %j", (raw) => {
    const env = { GMAIL_API_URL: raw };
    expect(googleServer(env)).toEqual(googleServer({}));
    expect(googleAddressAllowed(raw, env)).toBe(false);
    expect(googleAddressAllowed("https://oauth2.googleapis.com/token", env)).toBe(true);
  });

  it("is ignored in production, even on this machine's own address", () => {
    const env = { GMAIL_API_URL: LOCAL, VERCEL_ENV: "production" };
    expect(googleServer(env)).toEqual(googleServer({}));
    expect(googleAddressAllowed(`${LOCAL}/token`, env)).toBe(false);
    expect(googleAddressAllowed("https://oauth2.googleapis.com/token", env)).toBe(true);
  });

  it.each(["preview", "development", ""])("works where VERCEL_ENV is %j", (where) => {
    const env = { GMAIL_API_URL: LOCAL, VERCEL_ENV: where };
    expect(googleServer(env).api).toBe(`${LOCAL}/gmail/v1/users/me`);
  });

  it("reads the real settings when none are passed", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("GMAIL_API_URL", LOCAL);
    expect(googleServer().token).toBe(`${LOCAL}/token`);
    expect(googleAddressAllowed(`${LOCAL}/token`)).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(googleServer().token).toBe("https://oauth2.googleapis.com/token");
    expect(googleAddressAllowed(`${LOCAL}/token`)).toBe(false);
  });
});

describe("mail from a person, not a company", () => {
  it.each(["gmail.com", "icloud.com", "outlook.com", "mail.com", "hey.com", "comcast.net"])(
    "counts %s",
    (domain) => {
      expect(PERSONAL_MAIL_DOMAINS.has(domain)).toBe(true);
    },
  );

  // The large free services and internet providers the final review found missing: Yahoo's older
  // name and its addresses in other countries, large providers abroad, and more in the US.
  it.each([
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
    "btinternet.com",
    "gmx.de",
    "web.de",
    "t-online.de",
    "orange.fr",
    "rogers.com",
    "shaw.ca",
    "bigpond.com",
    "earthlink.net",
    "optonline.net",
    "frontier.com",
    "windstream.net",
    "juno.com",
    "duck.com",
  ])("counts %s, a large free service or internet provider", (domain) => {
    expect(PERSONAL_MAIL_DOMAINS.has(domain)).toBe(true);
  });

  // Microsoft's free mail in other countries: Hotmail, Live and Outlook addresses outside the US.
  it.each([
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
  ])("counts %s, Microsoft's free mail in another country", (domain) => {
    expect(PERSONAL_MAIL_DOMAINS.has(domain)).toBe(true);
  });

  // Each only ends, starts or reads like a listed one.
  it.each([
    "email.com",
    "company-mail.com",
    "mail.gmail.com",
    "notgmail.com",
    "gmail.com.evil.example",
    "gmail.co",
    "gmail.com.",
    ".gmail.com",
    "GMAIL.COM",
    "they.com",
    "",
    // A company's own mail at one of the providers, or a domain only like one.
    "mail.yahoo.co.uk",
    "alerts.rogers.com",
    "billing.frontier.com",
    "yahoo.co",
    "yahoo.co.uk.evil.example",
    "notyahoo.ca",
    "YAHOO.CO.UK",
    "myduck.com",
    "duck.com.evil.example",
    "eweb.de",
    "web.de.",
    "orange.fr.example",
    "hotmail.co",
    "nothotmail.fr",
    "hotmail.de.evil.example",
    "billing.hotmail.co.uk",
    "HOTMAIL.IT",
    "live.co",
    "olive.ca",
    "mail.live.com.au",
    "live.fr.",
    "outlook.de.example",
    "myoutlook.es",
    "news.outlook.it",
  ])("matches exactly, so %j is not one", (domain) => {
    expect(PERSONAL_MAIL_DOMAINS.has(domain)).toBe(false);
  });

  it("is every address anyone can sign up for that the agent knows, and sixty-four more", () => {
    for (const domain of SHARED_MAIL_DOMAINS) expect(PERSONAL_MAIL_DOMAINS.has(domain)).toBe(true);
    expect(PERSONAL_MAIL_DOMAINS.size).toBe(SHARED_MAIL_DOMAINS.length + 64);
    for (const domain of PERSONAL_MAIL_DOMAINS) expect(domain).toMatch(/^[a-z0-9-]+(\.[a-z]+)+$/);
  });
});

describe("mail Jane never looks at", () => {
  it("is junk, what the person wrote, chats and the advertising, social and forum tabs", () => {
    expect([...SKIPPED_LABELS].sort()).toEqual([
      "CATEGORY_FORUMS",
      "CATEGORY_PROMOTIONS",
      "CATEGORY_SOCIAL",
      "CHAT",
      "DRAFT",
      "SENT",
      "SPAM",
      "TRASH",
    ]);
  });

  it.each(["INBOX", "CATEGORY_UPDATES", "CATEGORY_PERSONAL", "UNREAD", "IMPORTANT", "STARRED"])(
    "isn't mail labelled %s, where receipts and bills arrive",
    (label) => {
      expect(SKIPPED_LABELS.has(label)).toBe(false);
    },
  );
});

describe("what the two tables keep", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  // A model's lines, without its comments and @@ lines.
  const linesOf = (model: string): string[] =>
    (schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"));

  // Each field with its type.
  const fieldsOf = (model: string): Record<string, string> =>
    Object.fromEntries(
      linesOf(model).map((line): [string, string] => {
        const [name, type] = line.split(/\s+/);
        return [name, type];
      }),
    );

  // A new column here is a new thing kept about someone's email: decide that before adding it.
  it("is what an email said and never its words: a reading has exactly these columns", () => {
    expect(fieldsOf("GmailReading")).toEqual({
      id: "String",
      userId: "String",
      mailboxId: "String",
      // Gmail's id for the message, when it arrived, and the registrable part of the sender's
      // domain as Google checked it.
      messageRef: "String",
      receivedAt: "DateTime",
      senderDomain: "String",
      // One of GMAIL_KINDS, cents and a day: all three checked in code before they're saved.
      kind: "String",
      amountCents: "Int?",
      occursOn: "DateTime?",
      createdAt: "DateTime",
      user: "User",
      mailbox: "GmailMailbox",
    });
  });

  it("is the address, the sealed tokens and Jane's own bookkeeping: nothing from an email", () => {
    expect(Object.keys(fieldsOf("GmailMailbox")).sort()).toEqual(
      [
        "id",
        "userId",
        // The only place a mailbox's address is kept.
        "address",
        "secretsEncrypted",
        "accessExpiresAt",
        "status",
        "disclosureVersion",
        "agreedAt",
        "historyCursor",
        "watchExpiresAt",
        "lastCheckedAt",
        "missedAt",
        "lastErrorCode",
        "failures",
        "nextTryAt",
        "syncingSince",
        "createdAt",
        "updatedAt",
        "user",
        "readings",
      ].sort(),
    );
  });

  it("goes with the person, and a mailbox's readings with the mailbox", () => {
    const cascades = (model: string) =>
      linesOf(model)
        .filter((line) => line.includes("onDelete: Cascade"))
        .map((line) => line.split(/\s+/)[1]);
    expect(cascades("GmailMailbox")).toEqual(["User"]);
    expect(cascades("GmailReading")).toEqual(["User", "GmailMailbox"]);
  });
});

describe("what the reader may say and cost", () => {
  it("names the kinds the table's own comment lists", () => {
    const listed = `${GMAIL_KINDS.slice(0, -1).join(", ")} or ${GMAIL_KINDS.at(-1)}`;
    expect(readFileSync("prisma/schema.prisma", "utf8")).toContain(
      `// ${listed} (GMAIL_KINDS in src/config/gmail.ts).`,
    );
  });

  // A model with no listed price is held at the dearest one, which would end a person's day of
  // Claude after a handful of emails.
  it("reads with a model whose price is listed", () => {
    expect(Object.keys(MODEL_PRICES_CENTS)).toContain(GMAIL_READER_MODEL);
  });

  it("leaves the rest of Jane a share of the month's Claude", () => {
    expect(GMAIL_MONTH_SHARE).toBeGreaterThan(0);
    expect(GMAIL_MONTH_SHARE).toBeLessThan(1);
  });
});

describe("limits that stand on each other", () => {
  // maxDuration on the routes that read mail.
  const FUNCTION_MS = 300_000;

  it("lets a read finish and let go before the function is ended", () => {
    expect(GMAIL_LIMITS.runBudgetMs).toBeLessThan(FUNCTION_MS);
    expect(GMAIL_LIMITS.cronBudgetMs).toBeLessThan(FUNCTION_MS);
    expect(GMAIL_LIMITS.nightMailboxBudgetMs).toBeLessThan(GMAIL_LIMITS.cronBudgetMs);
  });

  // A mailbox never read through, or whose last read was unfinished, gets a whole read when it is
  // the first of the daily job's run (src/lib/gmail/sync.ts): the run must hold one.
  it("has room in the daily job for a whole read", () => {
    expect(GMAIL_LIMITS.runBudgetMs).toBeLessThanOrEqual(GMAIL_LIMITS.cronBudgetMs);
  });

  // A read looks at its clock between one email and the next, so when its time is up it can still be
  // in one email: its first look and its body from Gmail, every try of each running to its timeout
  // with the waits between them, one of the two turned away and sent again after a renewal, and
  // Claude's one request. Nothing else a read does between two looks takes as long (a renewal and a
  // watch before it starts, a gap in the history). Each mailbox's budget ends inside the job's.
  // Around the job, the switches and its two heartbeats have a few seconds each. All of it ends with
  // 20 seconds to spare (DESIGN §17.4): for the database, and a function just woken.
  it("ends the daily job, and the last email it took on, before the function is ended", () => {
    const { callRetries, callRetryWaitMs, callTimeoutMs, cronBudgetMs, readerMostMs } =
      GMAIL_LIMITS;
    const waits = callRetryWaitMs * ((callRetries * (1 + callRetries)) / 2);
    const oneFetch = callTimeoutMs * (1 + callRetries) + waits;
    const renewedFetch = oneFetch + callTimeoutMs + oneFetch;
    const oneEmail = oneFetch + renewedFetch + readerMostMs;
    const theJobsOwn = OPS_SWITCH_FIRST_READ_TIMEOUT_MS + 2 * HEARTBEAT_TIMEOUT_MS;
    expect(theJobsOwn + cronBudgetMs + oneEmail + 20_000).toBeLessThanOrEqual(FUNCTION_MS);
  });

  // An answer from Claude that didn't begin in time is that email's own trouble, and it is skipped:
  // the request as a whole is let go only after that.
  it("lets a request to Claude go only after its answer was due to begin", () => {
    expect(GMAIL_LIMITS.readerMostMs).toBeGreaterThan(GMAIL_LIMITS.readerTimeoutMs);
  });

  it("keeps a read's lock longer than any function can run", () => {
    expect(GMAIL_LIMITS.lockMinutes * 60_000).toBeGreaterThan(FUNCTION_MS);
  });

  it("asks for notices again before Google's week is up, and not on every read", () => {
    const WATCH_HOURS = 7 * 24;
    expect(GMAIL_LIMITS.watchRenewHours).toBeLessThan(WATCH_HOURS);
    // A mailbox read only by the daily job is asked about in time even if one day's job is missed.
    expect(GMAIL_LIMITS.watchRenewHours).toBeGreaterThan(2 * 24);
  });

  it("waits longer after each failure, up to the most", () => {
    expect(GMAIL_LIMITS.backoffMinutes).toBeLessThan(GMAIL_LIMITS.backoffMostHours * 60);
  });
});

describe("the counts of emails Claude reads for a person", () => {
  const DAY = 24 * 60 * 60;

  it("hold one sender under a person's day, and a person under thirty full days", () => {
    const { gmailReads, gmailReadsMonth, gmailSenderReads } = RATE_LIMITS;
    expect(gmailReads.windowSeconds).toBe(DAY);
    expect(gmailSenderReads.windowSeconds).toBe(DAY);
    expect(gmailSenderReads.limit).toBeLessThan(gmailReads.limit);
    expect(gmailReadsMonth.windowSeconds).toBe(30 * DAY);
    expect(gmailReadsMonth.limit).toBeGreaterThan(gmailReads.limit);
    expect(gmailReadsMonth.limit).toBeLessThan(30 * gmailReads.limit);
  });

  // Both cleanups (src/lib/rate-limit.ts, src/lib/retention.ts) delete a counter once its window
  // began longer ago than the retention, unless its key starts with a kept prefix. A 30-day count
  // that isn't kept is deleted on its second day and starts again, so its limit is never reached.
  it("are kept through the cleanup when their window outlasts it", () => {
    const outlasting = Object.entries(RATE_LIMITS)
      .filter(([name]) => name.startsWith("gmail"))
      .filter(([, { windowSeconds }]) => windowSeconds > RATE_LIMIT_RETENTION_HOURS * 60 * 60)
      .map(([name]) => `${name}:`);
    expect(outlasting).toEqual(["gmailReadsMonth:"]);
    for (const prefix of outlasting) expect(KEEP_RATE_LIMIT_PREFIXES).toContain(prefix);
  });
});
