import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_EVENTS } from "@/config/access-log";
import { GMAIL_LIMITS, GMAIL_SCOPE } from "@/config/gmail";
import { gmailDisclosure } from "@/config/gmail-disclosure";
import { INACTIVE_ITEM_DAYS, REMOVAL_WARNING_DAYS } from "@/config/retention";
import { POSTHOG_EVENTS } from "@/lib/analytics-events";

// The person's own sign-ins, at the top of /security, need a session: not what this checks.
vi.mock("./security/your-activity", () => ({ YourActivity: () => null }));

import GoodbyePage from "./goodbye/page";
import PrivacyPage from "./privacy/page";
import SecurityPage from "./security/page";
import TermsPage from "./terms/page";

// What the legal pages say about Gmail mailboxes (DESIGN section 11; the words are
// critique-promises.md section 3's, with no company name, since none is kept). Said only while the
// switch is on, and each promise here is checked against the code it describes, as
// legal-pages.test.tsx does for Robinhood: a change to one breaks this until the pages say it too.

const text = (page: () => React.ReactElement) =>
  renderToStaticMarkup(page())
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    // A link ending before a comma leaves a space no reader sees.
    .replace(/ ([.,])/g, "$1");
const source = (path: string) => readFileSync(path, "utf8");
const PAGES = { PrivacyPage, TermsPage, SecurityPage, GoodbyePage };

afterEach(() => vi.unstubAllEnvs());

describe("Gmail mailboxes on the legal pages", () => {
  it("aren't mentioned while the switch is off", () => {
    vi.stubEnv("GMAIL_LINK", "");
    for (const [name, page] of Object.entries(PAGES)) {
      expect(text(page), name).not.toMatch(/gmail|mailbox/i);
      // The sentences only mailboxes bring that name neither.
      expect(text(page), name).not.toMatch(/Google doesn't confirm|apps with access|Limited Use/);
    }
  });

  it("say what's kept from each email, and that no text is: the table has no column for it", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(
      /what kind it is \(a bill, a receipt, a renewal, a price change or a refund\), its amount, the day it's about, the domain of the address it came from, when it arrived and Google's id for it/,
    );
    expect(privacy).toMatch(/Jane keeps no text from an email/);
    const schema = source("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model GmailReading {")).split("\n}")[0];
    const columns = [...model.matchAll(/^ {2}(\w+)\s/gm)].map((m) => m[1]);
    expect(columns).toEqual([
      "id",
      "userId",
      "mailboxId",
      "messageRef",
      "receivedAt",
      "senderDomain",
      "kind",
      "amountCents",
      "occursOn",
      "createdAt",
      "user",
      "mailbox",
    ]);
  });

  it("say how far back the first read goes, from the limits it uses", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    expect(text(PrivacyPage)).toContain(
      `newest emails from the last ${GMAIL_LIMITS.lookBackDays} days, ${GMAIL_LIMITS.lookBackMessages} at most`,
    );
    const sync = source("src/lib/gmail/sync.ts");
    expect(sync).toMatch(/days: GMAIL_LIMITS\.lookBackDays/);
    expect(sync).toMatch(/most: GMAIL_LIMITS\.lookBackMessages/);
  });

  it("say Jane only reads, and it asks Google for nothing more", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    expect(GMAIL_SCOPE).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(text(PrivacyPage)).toMatch(/If you connect a Gmail mailbox, read-only/);
    expect(text(TermsPage)).toMatch(/Jane can't send, delete or change email/);
  });

  it("say what Anthropic receives from an email, with what's taken out first", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(
      /its subject and its text, with links, email addresses and long numbers taken out, to pick out what kind it is, the amount and the date/,
    );
    const cleaned = source("src/lib/gmail/text.ts");
    for (const mark of ['"[link]"', '"[address]"', '"[number]"']) expect(cleaned).toContain(mark);
    expect(source("src/lib/gmail/read-message.ts")).toMatch(/body: forReader\(/);
  });

  it("keep the promise about passwords, and say the one exception and what stands in its way", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(
      /never receives your password, your bank sign-in or your Plaid connection\. An email from a mailbox you connect is the one exception/,
    );
    expect(privacy).toMatch(/Jane drops emails that look like sign-in codes or password resets/);
    // The subject is screened before the body is fetched, and everything sent is checked again.
    expect(source("src/lib/gmail/screen.ts")).toMatch(/"security"/);
    expect(source("src/lib/gmail/read-message.ts")).toMatch(/carriesSecret\([^)]*\) \? "security"/);
  });

  it("state Google's Limited Use, and that no team page shows a mailbox", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    const privacy = text(PrivacyPage);
    expect(privacy).toContain(
      "Jane's use of information received from Google APIs follows Google's API Services User Data Policy, including its Limited Use requirements.",
    );
    // Google's policy forbids creating, training or improving a model with the data, not only
    // training one.
    expect(privacy).toMatch(
      /never for advertising or for lending or credit decisions, never sold and never used to create, train or improve AI models/,
    );
    // The policy's name is a link to Google's own page for it.
    expect(renderToStaticMarkup(PrivacyPage())).toMatch(
      /<a href="https:\/\/developers\.google\.com\/terms\/api-services-user-data-policy"[^>]*>API Services User Data Policy<\/a>/,
    );
    expect(privacy).toMatch(/No team page shows your mailbox's address or what Jane read/);
    const admin = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? admin(path) : [path];
      });
    const naming = admin("src/app/admin").filter((path) => /gmail|mailbox/i.test(source(path)));
    expect(naming).toEqual([]);
  });

  it("say the tokens are encrypted, and they are", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    expect(text(PrivacyPage)).toMatch(/Gmail connection tokens are encrypted the same way/);
    expect(source("src/lib/gmail/secrets.ts")).toMatch(/encrypt\(JSON\.stringify/);
  });

  it("say Disconnect deletes what was read before Google is asked, and Google may not confirm", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(
      /Disconnecting a mailbox deletes its address, Jane's access and everything read from it, and asks Google to end Jane's permission/,
    );
    expect(privacy).toMatch(/If Google doesn't confirm, Jane's own access is still deleted/);
    const schema = source("prisma/schema.prisma");
    expect(schema).toMatch(
      /mailbox GmailMailbox @relation\(fields: \[mailboxId\], references: \[id\], onDelete: Cascade\)/,
    );
    const mailbox = source("src/lib/gmail/mailbox.ts");
    const removal = mailbox.slice(mailbox.indexOf("export async function removeMailbox("));
    expect(removal.indexOf("deleteMany(")).toBeGreaterThan(0);
    expect(removal.indexOf("deleteMany(")).toBeLessThan(removal.indexOf("revokeTokens("));
  });

  it("say mailboxes go with an account and after a long time unused, and the code does it", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    expect(text(PrivacyPage)).toContain(
      `If you don't use the app for ${INACTIVE_ITEM_DAYS} days, we disconnect your mailboxes too (we email you ${REMOVAL_WARNING_DAYS} days before).`,
    );
    expect(text(PrivacyPage)).toMatch(/Before disconnecting banks or mailboxes you haven't used/);
    expect(text(PrivacyPage)).toMatch(/and disconnects your mailboxes, asking Google to end/);
    expect(text(SecurityPage)).toMatch(
      new RegExp(
        `Inactive bank connections and mailboxes are removed after ${INACTIVE_ITEM_DAYS} days`,
      ),
    );
    expect(text(GoodbyePage)).toMatch(/We disconnected your banks and mailboxes/);
    expect(source("src/lib/account-deletion.ts")).toMatch(
      /removeAllMailboxes\(\s*userId,\s*"user_deleted_data"/,
    );
    // Called there by whatever name stands in for it in tests, as removeRobinhood does.
    const inactive = source("src/lib/plaid/inactive.ts");
    expect(inactive).toMatch(
      /import \{[^}]*\bremoveAllMailboxes\b[^}]*\} from "@\/lib\/gmail\/mailbox"/,
    );
    expect(inactive).toMatch(/\w*(?:Mailboxes|Gmail)\w*\([^)]*"inactive"/);
  });

  it("say a mailbox taken by another account leaves what was read with the first", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    expect(text(PrivacyPage)).toMatch(
      /Jane stops reading it for the first, which keeps what Jane read for it until it disconnects/,
    );
    const mailbox = source("src/lib/gmail/mailbox.ts");
    expect(mailbox).toMatch(/status: STATUS\.elsewhere/);
    // Readings go only with their mailbox's row (the cascade above), never on their own.
    expect(mailbox).not.toMatch(/gmailReadings?\.delete/);
  });

  it("say connecting and disconnecting are security records, kept without the address", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(/link or disconnect a bank, connect or disconnect a mailbox, download/);
    expect(privacy).toMatch(/without the mailbox's address/);
    expect(ACCESS_EVENTS).toEqual(
      expect.arrayContaining(["gmail_connected", "gmail_disconnected"]),
    );
    // The callback writes gmail_connected; removeMailbox writes gmail_disconnected.
    const audits = ["src/lib/gmail/mailbox.ts", "src/app/api/gmail/callback/route.ts"].flatMap(
      (path) => [...source(path).matchAll(/logAudit\(([^;]*)\);/g)].map(([call]) => call),
    );
    for (const event of ["gmail_connected", "gmail_disconnected"]) {
      expect(
        audits.some((call) => call.includes(`"${event}"`)),
        event,
      ).toBe(true);
    }
    for (const call of audits) expect(call).not.toMatch(/address/);
  });

  it("keep PostHog's promise: no mailbox event leaves", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    expect(text(PrivacyPage)).toMatch(
      /Never your email, your account details or your transactions/,
    );
    expect([...POSTHOG_EVENTS].filter((name) => name.startsWith("gmail_"))).toEqual([]);
  });

  it("say emails can mislead and the mailbox must be the person's own, as the page does", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    const terms = text(TermsPage);
    expect(terms).toMatch(/Emails can be wrong or dishonest, and Jane can misread them/);
    const own = "Only connect a mailbox that's yours, and not one from work or school.";
    expect(terms).toContain(own);
    expect(gmailDisclosure()).toContain(own);
    expect(terms).toMatch(/You can disconnect a bank or a mailbox, download your data/);
  });

  it("leave every pinned sentence as it was, and call Jane 'it'", () => {
    vi.stubEnv("GMAIL_LINK", "1");
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(/Your transactions, chats, documents and tax tags can still show/);
    expect(privacy).toMatch(/So can a money email from a mailbox you connect/);
    expect(privacy).toMatch(/your sign-ins, two-factor changes and downloads/);
    expect(privacy).toMatch(/it can receive the description your bank wrote on a transaction/);
    for (const page of [privacy, text(TermsPage)]) {
      expect(page).not.toMatch(/\b(she|her|hers)\b/i);
    }
  });
});
