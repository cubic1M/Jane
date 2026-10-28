import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_DISCLOSURE } from "@/config/activity";
import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { CONCIERGE_ACTIONS } from "@/config/concierge";
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
      /never receives your password, your bank sign-in, your Plaid connection, your account numbers or your raw bank descriptions/,
    );
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
