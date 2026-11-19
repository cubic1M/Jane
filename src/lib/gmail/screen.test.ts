import { describe, expect, it } from "vitest";
import { GMAIL_LIMITS, PERSONAL_MAIL_DOMAINS, SKIPPED_LABELS } from "@/config/gmail";
import type { MailMeta } from "./message";
import { screenMail } from "./screen";

// Which emails are read at all: five rules, in order, over what Gmail gives before any body is
// fetched. One row per rule, and the near misses each rule has to leave alone.

const googleSays = (domain: string, dmarc = "pass") =>
  `mx.google.com; spf=pass (google.com: domain of bounce@${domain} designates 203.0.113.9 as permitted sender) smtp.mailfrom=bounce@${domain}; dmarc=${dmarc} (p=REJECT sp=REJECT dis=NONE) header.from=${domain}`;

const meta = (over: Partial<MailMeta> = {}): MailMeta => ({
  id: "18c0ffee",
  labelIds: ["INBOX", "CATEGORY_UPDATES"],
  snippet: "",
  receivedAt: new Date("2026-11-18T12:00:00Z"),
  sizeEstimate: 2_000,
  from: ["Acme Power <billing@acme-power.example>"],
  subject: "Your bill is ready",
  authResults: [googleSays("acme-power.example")],
  fetched: false,
  ...over,
});

// The same email from another domain, vouched for by Google.
const from = (domain: string, over: Partial<MailMeta> = {}) =>
  meta({ from: [`Sender <someone@${domain}>`], authResults: [googleSays(domain)], ...over });

const KEPT = { keep: true, senderDomain: "acme-power.example" };
const skipped = (why: string) => ({ keep: false, why });

describe("an email that is read", () => {
  it("comes from a company Google vouches for and looks like it's about money", () => {
    expect(screenMail(meta())).toEqual(KEPT);
  });

  it("is kept under the company's own name, not the machine that sent it", () => {
    expect(screenMail(from("em1234.mail.acme-power.example"))).toEqual(KEPT);
    expect(screenMail(from("billing.bigco.co.uk"))).toEqual({
      keep: true,
      senderDomain: "bigco.co.uk",
    });
  });
});

describe("rule 1: mail Jane never looks at", () => {
  it.each([...SKIPPED_LABELS])("skips what Gmail labelled %s", (label) => {
    expect(screenMail(meta({ labelIds: ["INBOX", label] }))).toEqual(skipped("label"));
  });

  it("lists the labels the design names", () => {
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

  it.each([
    ["no labels at all", []],
    ["the inbox", ["INBOX"]],
    ["the updates tab", ["CATEGORY_UPDATES", "UNREAD", "IMPORTANT"]],
    ["the primary tab", ["CATEGORY_PERSONAL", "STARRED"]],
    ["a label the person made", ["Label_12", "INBOX"]],
    ["a label that only looks like one", ["spam", "SPAM_REVIEWED", "NOT_TRASH"]],
  ])("reads mail with %s", (_what, labelIds) => {
    expect(screenMail(meta({ labelIds }))).toEqual(KEPT);
  });
});

describe("rule 2: mail Google didn't vouch for", () => {
  it.each([
    ["Google says DMARC failed", { authResults: [googleSays("acme-power.example", "fail")] }],
    ["Google passed another domain", { authResults: [googleSays("evil.example")] }],
    ["there is no header of Google's", { authResults: [] }],
    [
      "a second header claims to be Google's",
      {
        authResults: [
          googleSays("acme-power.example", "fail"),
          "mx.google.com; dmarc=pass header.from=acme-power.example",
        ],
      },
    ],
    ["there are two From headers", { from: ["billing@acme-power.example", "x@evil.example"] }],
    ["Gmail fetched it from another mailbox", { fetched: true }],
    [
      "the domain reads like a phone number",
      {
        from: ["billing@call-8885550142.example"],
        authResults: [googleSays("call-8885550142.example")],
      },
    ],
  ])("skips an email when %s", (_what, over) => {
    expect(screenMail(meta(over))).toEqual(skipped("unverified"));
  });
});

describe("rule 3: a person writing, not a company", () => {
  it.each([
    "gmail.com",
    "icloud.com",
    "outlook.com",
    "yahoo.com",
    "comcast.net",
    "att.net",
    "hey.com",
  ])("skips mail from %s", (domain) => {
    expect(PERSONAL_MAIL_DOMAINS.has(domain)).toBe(true);
    expect(screenMail(from(domain))).toEqual(skipped("personal"));
  });

  it("skips it whatever case the address is written in", () => {
    expect(screenMail(from("GMail.COM"))).toEqual(skipped("personal"));
  });

  it("goes by the whole domain: comcast.net is people, alerts.comcast.net is Comcast", () => {
    expect(screenMail(from("comcast.net"))).toEqual(skipped("personal"));
    expect(screenMail(from("alerts.comcast.net"))).toEqual({
      keep: true,
      senderDomain: "comcast.net",
    });
    expect(screenMail(from("billing.att.net"))).toEqual({ keep: true, senderDomain: "att.net" });
  });

  it("reads a company whose domain only ends like a personal one", () => {
    expect(screenMail(from("notgmail.com"))).toEqual({ keep: true, senderDomain: "notgmail.com" });
    expect(screenMail(from("mail.com.example"))).toEqual({
      keep: true,
      senderDomain: "com.example",
    });
  });
});

describe("rule 4: a way into an account", () => {
  it.each([
    "Your verification code",
    "Your Acme verification code is 482913",
    "482913 is your Acme verification code",
    "123456 is your Facebook confirmation code",
    "G-482913 is your Google code",
    "Your one-time passcode",
    "Your one time password",
    "Your one time code",
    "Your onetime code",
    "Your log in code",
    "Your one-time PIN for this payment",
    "Security code for your payment",
    "Your login code",
    "Your sign-in code",
    "Sign in code: 482913",
    "Your access code",
    "Your 2FA code",
    "Your authentication code",
    "Use this code to sign in",
    "Your OTP for this payment",
    "Two-factor authentication is on",
    "2-step verification",
    "Reset your password",
    "RESET YOUR PASSWORD",
    "Reset   your\tpassword",
    "Password reset request",
    "Forgot your password?",
    "Your password was changed",
    "Your password has been reset",
    "Change your password",
    "Set a new password",
    "Your new password",
    "Your temporary password",
    "Your sign-in link",
    "Your magic link",
    "Here is your link to sign in",
    "Confirm your email address",
    "Verify your email",
    "Please verify your account to keep your subscription",
    "Activate your account",
    "Confirm your subscription",
    "Email verification for your billing account",
  ])("skips the subject: %s", (subject) => {
    // Even with money in the first lines: a code is never read.
    const mail = meta({ subject, snippet: "Your payment of $35.00 is waiting." });
    expect(screenMail(mail)).toEqual(skipped("security"));
  });

  it.each([
    "Sign in to pay your bill",
    "Your payment of $35.00 is due December 1. Sign in to pay.",
    "Your flight receipt. Confirmation code: X7TQ2",
    "Order confirmation: your shipping address",
    "Receipt for your order: promo code SAVE20 applied",
    "Invoice 4471 for billing ZIP code 94105",
    "Your bill is ready: log in to view it",
    "Your statement is ready. Never share your password.",
    "Password-protected statement attached",
    "Verify your payment method to keep your subscription",
    "Your subscription is confirmed",
    "Confirm your order to complete your purchase",
    "Your receipt from the Code Academy",
    "Your PIN purchase of $25.00 at Acme",
    "Your new price starts January 1",
  ])("reads the subject: %s", (subject) => {
    expect(screenMail(meta({ subject }))).toEqual(KEPT);
  });

  it("goes by the subject: a code in the body is the body check's to find", () => {
    const mail = meta({
      subject: "Approve your payment",
      snippet: "Your verification code is 482913",
    });
    expect(screenMail(mail)).toEqual(KEPT);
  });
});

describe("rule 5: nothing says money", () => {
  it.each([
    "Receipt",
    "Your receipts for October",
    "Invoice 4471",
    "You have been invoiced",
    "Refund issued",
    "We refunded you",
    "Your refunds are on the way",
    "Your statement is ready",
    "Your bill",
    "A billing update",
    "You were billed today",
    "Payment received",
    "Paid in full",
    "You've been charged",
    "Your subscription",
    "Your plan renews on December 1",
    "Renewal notice",
    "We renewed your plan",
    "Thanks for your order",
    "Order confirmation",
    "Order #4521 has shipped",
    "Amount due",
    "Payment due",
    "Your account is past due",
    "Your due date is coming up",
    "Your free trial",
    "Your trial ends soon",
    "A new price for your plan",
    "Our prices are changing",
    "A pricing update",
    "Your premium is going up",
    "Autopay is on",
    "Auto-pay scheduled",
    "Auto pay is set up",
    "Your purchase",
    "You purchased a plan",
    "Total: $15.49",
    "Total: $ 15.49",
    "We sent 15.49 USD",
    "USD 15.49 was sent",
    "You saved 20 dollars",
    "YOUR RECEIPT",
    "Your   order\tconfirmation",
  ])("reads the subject: %s", (subject) => {
    expect(screenMail(meta({ subject }))).toEqual(KEPT);
  });

  it.each([
    "Hello from Acme",
    "Welcome to Acme Power",
    "Your package has shipped",
    "New sign-in to your account",
    "We've updated our privacy policy",
    // Everyday words that mean money only in a phrase.
    "In order to continue, please reply",
    "An order of magnitude faster",
    "Closed due to weather",
    "The trial of the century",
    "Your trial",
    // Words that only hold the letters.
    "A billion thanks",
    "Pricey shoes are back",
    "Unpaid internships are over",
    "Receiptless returns",
    "Recharged and ready",
    "A dollar idea, 5 times over",
    "Dollars and sense: our newsletter",
    "Big $ savings on $$$ deals",
    "",
  ])("skips the subject: %s", (subject) => {
    expect(screenMail(meta({ subject }))).toEqual(skipped("no_money"));
  });

  it("reads the first lines too", () => {
    const quiet = { subject: "Hello from Acme" };
    expect(
      screenMail(meta({ ...quiet, snippet: "Your bill of $84.20 is due on December 1." })),
    ).toEqual(KEPT);
    // Gmail writes an apostrophe in the first lines as an entity.
    expect(screenMail(meta({ ...quiet, snippet: "You&#39;ve been charged for October." }))).toEqual(
      KEPT,
    );
    expect(screenMail(meta({ ...quiet, snippet: "Thanks for being with us." }))).toEqual(
      skipped("no_money"),
    );
  });

  it("reads only the start of a long subject and of long first lines", () => {
    const pad = "word ".repeat(GMAIL_LIMITS.subjectChars / 5);
    expect(pad).toHaveLength(GMAIL_LIMITS.subjectChars);
    expect(screenMail(meta({ subject: `${pad}receipt` }))).toEqual(skipped("no_money"));
    expect(screenMail(meta({ subject: "Hello", snippet: `${pad}receipt` }))).toEqual(
      skipped("no_money"),
    );
    expect(screenMail(meta({ subject: `${pad.slice(8)}receipt` }))).toEqual(KEPT);
    expect(
      screenMail(meta({ subject: `${pad}reset your password`, snippet: "a receipt" })),
    ).toEqual(KEPT);
  });
});

describe("the first rule that applies decides", () => {
  const code = { subject: "Your verification code" };

  it("a label comes before everything", () => {
    const mail = from("gmail.com", { ...code, labelIds: ["SPAM"], authResults: [] });
    expect(screenMail(mail)).toEqual(skipped("label"));
  });

  it("unverified comes before personal", () => {
    const mail = from("gmail.com", { ...code, authResults: [googleSays("gmail.com", "fail")] });
    expect(screenMail(mail)).toEqual(skipped("unverified"));
  });

  it("personal comes before security", () => {
    expect(screenMail(from("gmail.com", code))).toEqual(skipped("personal"));
  });

  it("security comes before no money", () => {
    expect(screenMail(meta(code))).toEqual(skipped("security"));
  });
});

// The screen runs on every email that arrives, over text its sender wrote.
const LONG = 100_000;

function elapsedMs(read: () => unknown): number {
  const start = performance.now();
  read();
  return performance.now() - start;
}

describe("a crafted email is screened in one pass", () => {
  it.each([
    ["one long word", "a".repeat(LONG)],
    ["spaces", " ".repeat(LONG)],
    ["dollar signs", "$".repeat(LONG)],
    ["digits", "1".repeat(LONG)],
    ["the word code", "code ".repeat(LONG / 5)],
    ["the word password", "password ".repeat(LONG / 9)],
    ["numbers that are someone's", "1234 is your ".repeat(LONG / 13)],
    ["half a phrase", "your order of your ".repeat(LONG / 19)],
    ["line breaks", "\n".repeat(LONG)],
  ])("a subject and first lines of %s", (_what, text) => {
    expect(elapsedMs(() => screenMail(meta({ subject: text, snippet: text })))).toBeLessThan(250);
  });

  it.each([
    ["brackets", "(".repeat(LONG)],
    ["quotes", '"'.repeat(LONG)],
    ["semicolons", ";".repeat(LONG)],
  ])("headers of %s", (_what, header) => {
    const crafted = meta({ from: [header], authResults: [header, `mx.google.com; ${header}`] });
    expect(elapsedMs(() => screenMail(crafted))).toBeLessThan(250);
    expect(screenMail(crafted)).toEqual(skipped("unverified"));
  });

  it("a hundred thousand labels", () => {
    const labelIds = Array.from({ length: LONG }, (_, i) => `Label_${i}`);
    expect(elapsedMs(() => screenMail(meta({ labelIds })))).toBeLessThan(250);
  });
});
