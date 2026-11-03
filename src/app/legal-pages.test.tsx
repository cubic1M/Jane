import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_DISCLOSURE } from "@/config/activity";
import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { CONCIERGE_ACTIONS } from "@/config/concierge";
import { STATEMENT_TRIAL_CHAT_ANSWERS, TRIAL_DELETED_WITHIN_HOURS } from "@/config/statement-trial";
import { TRIAL_HOURS } from "@/config/trial";
import { retentionPolicy } from "@/lib/retention";
import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";

// The Terms and the Privacy Policy say what the code does today (founder, 2026-10-26): each claim
// here is checked against the code it describes, so a change to one breaks this test until the
// pages say it too.

const text = (page: () => React.ReactElement) =>
  renderToStaticMarkup(page())
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

afterEach(() => vi.unstubAllEnvs());

describe("the legal pages", () => {
  it("say Plaid is read-only: transactions, with loan and investment details optional", () => {
    const link = readFileSync("src/lib/plaid/link.ts", "utf8");
    expect(link).toMatch(/products: \[Products\.Transactions\]/);
    // Loan details are optional; investment details are optional too, and asked for only while
    // PLAID_INVESTMENTS=1.
    expect(link).toMatch(
      /optional_products: \[\s*Products\.Liabilities,\s*\.\.\.\(plaidInvestmentsEnabled\(\) \? \[Products\.Investments\] : \[\]\),?\s*\]/,
    );
    // Nothing that moves money is asked for.
    expect(link).not.toMatch(/Products\.(Transfer|PaymentInitiation|Auth|Signal)/);
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(/through Plaid and read-only/);
    expect(privacy).toMatch(/investment details too, once Jane turns investment accounts on/);
    expect(privacy).toMatch(/It can never move money/);
    expect(text(TermsPage)).toMatch(/Jane never moves money/);
  });

  it("say real accounts get no advice and no one contacts a company for them", () => {
    expect(REAL_ACCOUNT_ADVICE).toBe(false);
    expect(CONCIERGE_ACTIONS.realAccounts).toBe(false);
    const terms = text(TermsPage);
    expect(terms).toMatch(/No financial advice for your real accounts/);
    expect(terms).toMatch(/Demo advice: sample data, not financial advice/);
    expect(terms).toMatch(/For your real accounts, Jane and our team don't contact companies/);
  });

  it("say the paper account is simulated money, sample data only", () => {
    const account = readFileSync("src/lib/paper/account.ts", "utf8");
    expect(account).toMatch(/adviceMode\(userId/);
    for (const page of [text(TermsPage), text(PrivacyPage)]) {
      expect(page).toMatch(/simulated money only/);
      expect(page).toMatch(/only with sample data/);
    }
  });

  it("list the retention periods from the code, and trials deleted after TRIAL_HOURS", () => {
    const privacy = text(PrivacyPage);
    for (const line of retentionPolicy()) expect(privacy).toContain(line.replace(/\s+/g, " "));
    expect(privacy).toContain(`deleted after ${TRIAL_HOURS} hours`);
    expect(text(TermsPage)).toContain(`${TRIAL_HOURS} hours`);
  });

  it("say what happens to a statement tried without an account, from the code", () => {
    const privacy = text(PrivacyPage);
    const terms = text(TermsPage);
    expect(TRIAL_DELETED_WITHIN_HOURS).toBe(72);
    expect(TRIAL_DELETED_WITHIN_HOURS).toBe(TRIAL_HOURS + 48);
    for (const page of [privacy, terms]) {
      expect(page).toMatch(/Trying Jane with your own statement/);
      expect(page).toContain(`within ${TRIAL_DELETED_WITHIN_HOURS} hours`);
    }
    // What's kept, for how long, and that it's temporary.
    expect(privacy).toMatch(/read once, in memory, and never stored as a file/);
    expect(privacy).toMatch(/a temporary person made for this try/);
    expect(privacy).toMatch(/Nothing is reused: each start makes a new one/);
    expect(privacy).toMatch(/a record that a try started and was deleted/);
    expect(privacy).toMatch(/nothing from your statement/);
    expect(privacy).toContain(
      `sign-in cookie for that person, which works for ${TRIAL_HOURS} hours`,
    );
    expect(privacy).toMatch(/goes at the next daily clean-up/);
    // src/lib/edge-limits.ts counts a hash of the IP and of the session token.
    expect(privacy).toMatch(/scrambled form of your IP address and of your sign-in cookie/);
    expect(privacy).toMatch(/Reading your statement doesn't use Anthropic/);
    expect(privacy).toContain(`up to ${STATEMENT_TRIAL_CHAT_ANSWERS} written answers`);
    expect(privacy).toMatch(/Starting over can't call back what was already sent/);
    expect(privacy).toMatch(/never email you, never contact any company for you/);
    expect(privacy).toMatch(/can't link a bank/);
    expect(terms).toMatch(/It counts as a real account: no financial advice/);
    expect(terms).toMatch(/Only upload a statement that's yours to share/);
  });

  it("say what Jane remembers, what it never keeps, and where to see and delete it", () => {
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(/What Jane remembers about you/);
    expect(privacy).toMatch(/the chat starts empty/);
    expect(privacy).toMatch(
      /never keeps anything about your health, religion, politics, sexual orientation, ethnicity or immigration status/,
    );
    expect(privacy).toMatch(/correct or forget any of them, or delete all of Jane's memory/);
  });

  it("name every cookie the app sets", () => {
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(/A sign-in cookie keeps you signed in/);
    // fc_invite and fc_terms: 15 minutes (src/lib/auth-actions.ts).
    expect(readFileSync("src/lib/auth-actions.ts", "utf8")).toMatch(/maxAge: 15 \* 60/);
    expect(privacy).toMatch(/two short cookies \(15 minutes\)/);
    // fc_aid: a year (src/app/api/events/route.ts).
    expect(readFileSync("src/app/api/events/route.ts", "utf8")).toMatch(/ONE_YEAR_SECONDS/);
    expect(privacy).toMatch(/A random id cookie \(kept for a year\)/);
    expect(privacy).toMatch(/We don't use advertising cookies or tracking pixels/);
  });

  it("say the beta records pages and buttons, not what people type, on sign-up and in the policy", () => {
    expect(ACTIVITY_DISCLOSURE).toBe(
      "During the beta we record how you use Jane (pages and buttons, not what you type) to improve it.",
    );
    expect(text(PrivacyPage)).toContain(ACTIVITY_DISCLOSURE);
    expect(readFileSync("src/app/(auth)/signup/page.tsx", "utf8")).toMatch(
      /\{ACTIVITY_DISCLOSURE\}/,
    );
    // e2e/activity.spec.ts checks that typing in a field records no value.
    expect(text(PrivacyPage)).toMatch(/never the words or numbers themselves/);
  });

  it("say what goes to Anthropic, and what never does", () => {
    const privacy = text(PrivacyPage);
    expect(privacy).toMatch(/Anthropic makes Claude/);
    expect(privacy).toMatch(
      /never receives your password, your bank sign-in or your Plaid connection/,
    );
    // True of the chat: its tools read a transaction's bank description.
    expect(privacy).toMatch(/it can receive the description your bank wrote on a transaction/);
  });

  it("give the support address, else a founder's, else a clear placeholder", () => {
    vi.stubEnv("SUPPORT_EMAIL", "help@jane.example");
    expect(text(PrivacyPage)).toContain("help@jane.example");
    vi.stubEnv("SUPPORT_EMAIL", "");
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(text(TermsPage)).toContain("[contact email to be added: set SUPPORT_EMAIL]");
  });

  it("call Jane 'it', never 'she'", () => {
    for (const page of [text(TermsPage), text(PrivacyPage)])
      expect(page).not.toMatch(/\b(she|her|hers)\b/i);
  });
});
