import { describe, expect, it } from "vitest";
import { GMAIL_LIMITS } from "@/config/gmail";
import { fromDomain, mailMeta, rawBody, verifiedSender, type MailMeta } from "./message";

// Gmail's message JSON, narrowed: what is read from it, who Google says sent it, and its body. The
// sender writes every header but Google's own, so most of this file is headers a sender could
// write to pass as someone else (critique-security S2, delta-security D5), each of which must end
// as "not vouched for".

const FROM = "acme-power.example";

// What Google writes for an email it checked, in its own layout.
const googleSays = (domain = FROM, dmarc = "pass") =>
  `mx.google.com; dkim=pass header.i=@${domain} header.s=s1 header.b=AbC; spf=pass (google.com: domain of bounce@${domain} designates 203.0.113.9 as permitted sender) smtp.mailfrom=bounce@${domain}; dmarc=${dmarc} (p=REJECT sp=REJECT dis=NONE) header.from=${domain}`;

const meta = (over: Partial<MailMeta> = {}): MailMeta => ({
  id: "18c0ffee",
  labelIds: ["INBOX"],
  snippet: "",
  receivedAt: new Date("2026-11-18T12:00:00Z"),
  sizeEstimate: 2_000,
  from: [`Acme Power <billing@${FROM}>`],
  subject: "Your bill is ready",
  authResults: [googleSays()],
  fetched: false,
  ...over,
});

const char = (code: number) => String.fromCharCode(code);

describe("what is read from a message", () => {
  const raw = {
    id: "18c0ffee",
    threadId: "18c0ffee",
    labelIds: ["INBOX", "CATEGORY_UPDATES"],
    snippet: "Your bill of $84.20 is due on December 1.",
    historyId: "9001",
    internalDate: "1795000000000",
    sizeEstimate: 15_300,
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "Authentication-Results", value: googleSays() },
        { name: "ARC-Authentication-Results", value: `i=1; ${googleSays()}` },
        { name: "From", value: `Acme Power <billing@${FROM}>` },
        { name: "Subject", value: "Your bill is ready" },
        { name: "To", value: "someone@gmail.com" },
      ],
    },
  };

  it("takes the id, the labels, the first lines, the time, the size and the four headers", () => {
    expect(mailMeta(raw)).toEqual({
      id: "18c0ffee",
      labelIds: ["INBOX", "CATEGORY_UPDATES"],
      snippet: "Your bill of $84.20 is due on December 1.",
      receivedAt: new Date(1_795_000_000_000),
      sizeEstimate: 15_300,
      from: [`Acme Power <billing@${FROM}>`],
      subject: "Your bill is ready",
      authResults: [googleSays()],
      fetched: false,
    });
  });

  it("and nothing else: no recipient, no thread, no body", () => {
    expect(JSON.stringify(mailMeta(raw))).not.toMatch(/someone@gmail\.com|threadId|historyId/);
  });

  it("reads a header's name in any case", () => {
    const shouted = {
      id: "m",
      payload: {
        headers: [
          { name: "FROM", value: "a@b.example" },
          { name: "subject", value: "Hello" },
          { name: "AUTHENTICATION-RESULTS", value: "x" },
          { name: "x-gmail-fetch-info", value: "y" },
        ],
      },
    };
    expect(mailMeta(shouted)).toMatchObject({
      from: ["a@b.example"],
      subject: "Hello",
      authResults: ["x"],
      fetched: true,
    });
  });

  it("keeps every From header and every Authentication-Results header, in the order given", () => {
    const doubled = {
      id: "m",
      payload: {
        headers: [
          { name: "From", value: "one@a.example" },
          { name: "Authentication-Results", value: "first" },
          { name: "From", value: "two@b.example" },
          { name: "Authentication-Results", value: "second" },
          { name: "Subject", value: "The first subject" },
          { name: "Subject", value: "Another" },
        ],
      },
    };
    expect(mailMeta(doubled)).toMatchObject({
      from: ["one@a.example", "two@b.example"],
      authResults: ["first", "second"],
      subject: "The first subject",
    });
  });

  it("doesn't take an ARC header, or one with a longer name, for Authentication-Results", () => {
    const named = (name: string) =>
      mailMeta({ id: "m", payload: { headers: [{ name, value: googleSays() }] } })?.authResults;
    expect(named("ARC-Authentication-Results")).toEqual([]);
    expect(named("X-Original-Authentication-Results")).toEqual([]);
    expect(named("Authentication-Results-Original")).toEqual([]);
  });

  it("says when Gmail fetched the email from another mailbox", () => {
    const fetched = {
      id: "m",
      payload: { headers: [{ name: "X-Gmail-Fetch-Info", value: "a@b.example 1 pop.b.example" }] },
    };
    expect(mailMeta(fetched)?.fetched).toBe(true);
    expect(mailMeta(raw)?.fetched).toBe(false);
  });

  it("gives what Gmail left out as empty, never as a guess", () => {
    expect(mailMeta({ id: "m", payload: {} })).toEqual({
      id: "m",
      labelIds: [],
      snippet: "",
      receivedAt: null,
      sizeEstimate: null,
      from: [],
      subject: "",
      authResults: [],
      fetched: false,
    });
  });

  it.each([
    ["missing", undefined],
    ["a number", 1_795_000_000_000],
    ["a date in words", "Wed, 18 Nov 2026 12:00:00 +0000"],
    ["negative", "-5"],
    ["too long to be a time", "1".repeat(16)],
    ["empty", ""],
  ])("has no time received when Gmail's is %s", (_what, internalDate) => {
    expect(mailMeta({ ...raw, internalDate })?.receivedAt).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["text", "15300"],
    ["below zero", -1],
    ["not a number", Number.NaN],
  ])("has no size when Gmail's is %s", (_what, sizeEstimate) => {
    expect(mailMeta({ ...raw, sizeEstimate })?.sizeEstimate).toBeNull();
  });

  it.each([
    ["nothing", null],
    ["text", "a message"],
    ["a list", [raw]],
    ["no id", { payload: raw.payload }],
    ["an empty id", { ...raw, id: "" }],
    ["an id that isn't text", { ...raw, id: 5 }],
    ["no payload", { id: "m" }],
    ["headers that aren't a list", { id: "m", payload: { headers: { From: "a@b.example" } } }],
    ["a header without a value", { id: "m", payload: { headers: [{ name: "From" }] } }],
    ["a header that is only text", { id: "m", payload: { headers: ["From: a@b.example"] } }],
    ["a value that isn't text", { id: "m", payload: { headers: [{ name: "From", value: 5 }] } }],
    ["labels that aren't text", { ...raw, labelIds: ["INBOX", 5] }],
    ["labels that aren't a list", { ...raw, labelIds: "INBOX" }],
    ["first lines that aren't text", { ...raw, snippet: { text: "hello" } }],
  ])("is null for an answer that isn't a message: %s", (_what, answer) => {
    expect(mailMeta(answer)).toBeNull();
  });
});

describe("the sender Google vouches for", () => {
  it("is the From address's domain when Google's one header says DMARC passed for it", () => {
    expect(verifiedSender(meta())).toBe(FROM);
  });

  it("reads a real message end to end", () => {
    const raw = {
      id: "m",
      payload: {
        headers: [
          { name: "Authentication-Results", value: googleSays() },
          { name: "From", value: `"Acme Power, Inc." <billing@${FROM}>` },
        ],
      },
    };
    const read = mailMeta(raw);
    expect(read && verifiedSender(read)).toBe(FROM);
  });

  it.each([
    ["a bare address", `billing@${FROM}`],
    ["an address in brackets", `<billing@${FROM}>`],
    ["a name with a comma, in quotes", `"Acme Power, Inc." <billing@${FROM}>`],
    ["a name with quotes inside its quotes", `"Acme \\"Power\\" Billing" <billing@${FROM}>`],
    ["a name that holds another address", `"support@bank.example" <billing@${FROM}>`],
    ["a name with brackets in its quotes", `"Acme <Power> (billing)" <billing@${FROM}>`],
    ["a name in an encoded word", `=?UTF-8?Q?Acme_Caf=C3=A9?= <billing@${FROM}>`],
    ["a comment after the address", `billing@${FROM} (Acme Billing)`],
    ["a comment inside a comment", `Acme (billing (west)) <billing@${FROM}>`],
    ["a name with a colon", `Acme: Billing <billing@${FROM}>`],
    ["a domain in capitals", "Acme Power <Billing@ACME-Power.Example>"],
    ["a line folded in the middle", `Acme Power\r\n <billing@${FROM}>`],
  ])("takes one address from %s", (_what, from) => {
    expect(verifiedSender(meta({ from: [from] }))).toBe(FROM);
  });

  it.each([
    [
      "Google's header as it is on the wire, folded over lines",
      googleSays().replaceAll("; ", ";\r\n       "),
    ],
    ["lines folded with a tab", googleSays().replaceAll("; ", ";\n\t")],
    ["the method and the property in capitals", `MX.GOOGLE.COM; DMARC=pass Header.From=${FROM}`],
    ["the domain in capitals", "mx.google.com; dmarc=pass header.from=ACME-Power.Example"],
    ["only the dmarc clause", `mx.google.com; dmarc=pass header.from=${FROM}`],
    ["a clause after the dmarc one", `${googleSays()}; dara=pass header.i=@gmail.com`],
    ["an empty clause at the end", `${googleSays()};`],
    ["no space after a comment", `mx.google.com; dmarc=pass(p=NONE)header.from=${FROM}`],
    [
      "a comment inside a comment",
      `mx.google.com; spf=pass (google.com: domain of x (y) z) smtp.mailfrom=x; dmarc=pass header.from=${FROM}`,
    ],
  ])("reads %s", (_what, header) => {
    expect(verifiedSender(meta({ authResults: [header] }))).toBe(FROM);
  });

  it("isn't put off by another server's header beside Google's, in either place", () => {
    const theirs = `mail.${FROM}; dkim=pass header.d=${FROM}; dmarc=fail header.from=${FROM}`;
    expect(verifiedSender(meta({ authResults: [googleSays(), theirs] }))).toBe(FROM);
    expect(verifiedSender(meta({ authResults: [theirs, googleSays()] }))).toBe(FROM);
  });
});

describe("the part of a domain that is saved and shown", () => {
  const sentFrom = (domain: string) =>
    verifiedSender(meta({ from: [`billing@${domain}`], authResults: [googleSays(domain)] }));

  it("is the company's own name, without what stands before it", () => {
    expect(sentFrom("mail.billing.acme-power.example")).toBe(FROM);
    expect(sentFrom("em1234.acme-power.example")).toBe(FROM);
  });

  it("keeps three labels where the last two are an ending many companies share", () => {
    expect(sentFrom("billing.bigco.co.uk")).toBe("bigco.co.uk");
    expect(sentFrom("bigco.com.au")).toBe("bigco.com.au");
  });

  it("never shows a sentence or a phone number a sender put in front of its domain", () => {
    expect(sentFrom("refund-desk-call-888-555-0142.evil.example")).toBe("evil.example");
    expect(sentFrom("reply-with-your-online-banking-password.evil.example")).toBe("evil.example");
  });

  it.each([
    ["a phone number", "call-8885550142.example"],
    ["four digits in a row", "refunds-0142.example"],
    ["more than three hyphens", "reply-with-your-bank-password.example"],
    ["more than three hyphens over its two labels", "pay-the-fee.xn--p1ai"],
    ["more characters than a name has", `${"a".repeat(GMAIL_LIMITS.shownDomainChars)}.example`],
    ["only an ending many companies share", "co.uk"],
  ])("refuses a domain that is %s", (_what, domain) => {
    expect(sentFrom(domain)).toBeNull();
  });

  it("takes a domain right at each limit", () => {
    expect(sentFrom("a-b-c-d.example")).toBe("a-b-c-d.example");
    expect(sentFrom("route66-us101.example")).toBe("route66-us101.example");
    const longest = `${"a".repeat(GMAIL_LIMITS.shownDomainChars - ".example".length)}.example`;
    expect(sentFrom(longest)).toBe(longest);
  });
});

// Each row is an email Google did not vouch for, written to look as if it had.
describe("a sender Google didn't vouch for", () => {
  const forged: [string, Partial<MailMeta>][] = [
    [
      "the envelope address spells dmarc=pass, and Google's verdict is fail",
      {
        authResults: [
          `mx.google.com; spf=pass (google.com: domain of dmarc=pass@evil.example designates 198.51.100.7 as permitted sender) smtp.mailfrom=dmarc=pass@evil.example; dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=${FROM}`,
        ],
      },
    ],
    [
      "a comment says dmarc=pass",
      {
        authResults: [
          `mx.google.com; arc=pass (i=1 spf=pass spfdomain=evil.example dkim=pass dkdomain=evil.example dmarc=pass fromdomain=${FROM}); spf=pass (google.com: domain of x@evil.example designates 198.51.100.7 as permitted sender) smtp.mailfrom=x@evil.example; dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=${FROM}`,
        ],
      },
    ],
    [
      "a comment holds a whole dmarc clause, and there is no other",
      { authResults: [`mx.google.com; spf=pass (x; dmarc=pass header.from=${FROM}; y)`] },
    ],
    [
      "a comment inside a comment holds one",
      {
        authResults: [`mx.google.com; spf=pass (a (b); dmarc=pass header.from=${FROM}; c)`],
      },
    ],
    [
      "a quoted string holds one",
      {
        authResults: [
          `mx.google.com; spf=pass smtp.mailfrom="x; dmarc=pass header.from=${FROM}; y"@evil.example`,
        ],
      },
    ],
    [
      "two quoted strings stand either side of one",
      {
        authResults: [
          `mx.google.com; spf=pass smtp.mailfrom="a"; dmarc=pass header.from=${FROM}; x="b"@evil.example`,
        ],
      },
    ],
    [
      "a quoted string anywhere in a header that passes",
      {
        authResults: [
          `mx.google.com; spf=pass smtp.mailfrom="x y"@evil.example; dmarc=pass header.from=${FROM}`,
        ],
      },
    ],
    [
      "a quote inside a comment in a header that passes",
      {
        authResults: [
          `mx.google.com; spf=pass (google.com: domain of "x"@evil.example designates 198.51.100.7 as permitted sender); dmarc=pass header.from=${FROM}`,
        ],
      },
    ],
    [
      "an envelope address whose own brackets make a clause where Google copied it",
      {
        authResults: [
          `mx.google.com; spf=pass (google.com: domain of a(b); dmarc=pass header.from=${FROM}; x=(y)z@evil.example designates 198.51.100.7 as permitted sender) smtp.mailfrom=a(b); dmarc=pass header.from=${FROM}; x=(y)z@evil.example`,
        ],
      },
    ],
    [
      "a semicolon inside a comment in a header that passes",
      {
        authResults: [`mx.google.com; spf=pass (a; b); dmarc=pass header.from=${FROM}`],
      },
    ],
    [
      "a DKIM signature for a domain that only starts like the sender's",
      {
        authResults: [
          `mx.google.com; dkim=pass header.i=@${FROM}.evil.example header.s=k1 header.b=XyZ; spf=pass (google.com: domain of x@evil.example designates 198.51.100.7 as permitted sender) smtp.mailfrom=x@evil.example`,
        ],
      },
    ],
    [
      "a DKIM signature for the sender's own domain, and no DMARC verdict",
      { authResults: [`mx.google.com; dkim=pass header.i=@${FROM} header.s=s1 header.b=AbC`] },
    ],
    [
      "two dmarc clauses, pass then fail",
      {
        authResults: [
          `mx.google.com; dmarc=pass header.from=${FROM}; dmarc=fail header.from=${FROM}`,
        ],
      },
    ],
    [
      "two dmarc clauses, fail then pass",
      {
        authResults: [
          `mx.google.com; dmarc=fail header.from=${FROM}; dmarc=pass header.from=${FROM}`,
        ],
      },
    ],
    [
      "two dmarc clauses that both pass",
      {
        authResults: [
          `mx.google.com; dmarc=pass header.from=${FROM}; DMARC=pass header.from=${FROM}`,
        ],
      },
    ],
    [
      "a second dmarc clause written with spaces",
      { authResults: [`mx.google.com; dmarc=pass header.from=${FROM}; dmarc = fail`] },
    ],
    [
      "a second dmarc clause written with a version",
      {
        authResults: [
          `mx.google.com; dmarc/1=fail header.from=${FROM}; dmarc=pass header.from=${FROM}`,
        ],
      },
    ],
    [
      "the one dmarc clause is written with a version",
      { authResults: [`mx.google.com; dmarc/1=pass header.from=${FROM}`] },
    ],
    ["two From headers", { from: [`billing@${FROM}`, "x@evil.example"] }],
    ["the same From header twice", { from: [`billing@${FROM}`, `billing@${FROM}`] }],
    ["no From header", { from: [] }],
    [
      "a second header in Google's name, after the real one",
      { authResults: [googleSays(FROM, "fail"), `mx.google.com; dmarc=pass header.from=${FROM}`] },
    ],
    [
      "a second header in Google's name, before the real one",
      { authResults: [`mx.google.com; dmarc=pass header.from=${FROM}`, googleSays(FROM, "fail")] },
    ],
    ["two headers in Google's name that both pass", { authResults: [googleSays(), googleSays()] }],
    [
      "a second header that names Google in other letters",
      { authResults: [googleSays(), ` MX.Google.Com (relay) 1; dmarc=pass header.from=${FROM}`] },
    ],
    [
      "a second header that names Google in quotes",
      { authResults: [googleSays(), `"mx.google.com"; dmarc=pass header.from=${FROM}`] },
    ],
    [
      "no header of Google's, only the sender's own server",
      { authResults: [`mail.evil.example; dmarc=pass header.from=${FROM}`] },
    ],
    ["no Authentication-Results header at all", { authResults: [] }],
    [
      "a server whose name only starts with Google's",
      { authResults: [`mx.google.com.evil.example; dmarc=pass header.from=${FROM}`] },
    ],
    [
      "a server that names Google in a comment",
      { authResults: [`evil.example (mx.google.com); dmarc=pass header.from=${FROM}`] },
    ],
    [
      "Google's name with a version after it",
      { authResults: [`mx.google.com 1; dmarc=pass header.from=${FROM}`] },
    ],
    ["Gmail fetched it from another mailbox", { fetched: true }],
    [
      "Google's header is over the limit",
      {
        authResults: [
          `mx.google.com; spf=pass (${"x".repeat(GMAIL_LIMITS.headerChars)}); dmarc=pass header.from=${FROM}`,
        ],
      },
    ],
    [
      "a pass within the limit, and the real verdict pushed past it",
      {
        authResults: [
          `mx.google.com; dmarc=pass header.from=${FROM}; x=${"y".repeat(GMAIL_LIMITS.headerChars)}; dmarc=fail header.from=${FROM}`,
        ],
      },
    ],
    [
      "the From header is over the limit",
      { from: [`"${"A".repeat(GMAIL_LIMITS.headerChars)}" <billing@${FROM}>`] },
    ],
    [
      "a backslash hides a quote",
      {
        authResults: [
          `mx.google.com; spf=pass smtp.mailfrom="a\\"@evil.example; dmarc=pass header.from=${FROM}`,
        ],
      },
    ],
    [
      "a backslash anywhere in Google's header",
      { authResults: [`mx.google.com; x=a\\b; dmarc=pass header.from=${FROM}`] },
    ],
    [
      "a bracket that never closes",
      { authResults: [`mx.google.com; dmarc=pass header.from=${FROM}; x=(never closed`] },
    ],
    [
      "a quote that never closes",
      { authResults: [`mx.google.com; dmarc=pass header.from=${FROM}; x="never closed`] },
    ],
    [
      "a bracket that closes nothing",
      { authResults: [`mx.google.com; dmarc=pass header.from=${FROM}; x=y)`] },
    ],
    [
      "a quote inside Google's comment that would hide its end",
      {
        authResults: [
          `mx.google.com; spf=pass (google.com: domain of "a)b"@evil.example; dmarc=pass header.from=${FROM}; c"@evil.example designates 198.51.100.7 as permitted sender)`,
        ],
      },
    ],
    [
      "a control character in Google's header",
      { authResults: [`mx.google.com; dmarc=pass${char(0)} header.from=${FROM}`] },
    ],
    [
      "a line break that isn't a fold",
      { authResults: [`mx.google.com; dmarc=pass header.from=${FROM}\nX-Injected: yes`] },
    ],
    ["a control character in the From header", { from: [`Acme${char(7)} <billing@${FROM}>`] }],
    ["the verdict is fail", { authResults: [googleSays(FROM, "fail")] }],
    ["the verdict is none", { authResults: [googleSays(FROM, "none")] }],
    ["the verdict only starts with pass", { authResults: [googleSays(FROM, "passed")] }],
    ["the verdict is in capitals", { authResults: [googleSays(FROM, "PASS")] }],
    [
      "the verdict has more written after it",
      { authResults: [`mx.google.com; dmarc=pass=fail header.from=${FROM}`] },
    ],
    [
      "a comment splits a word that would read dmarc",
      { authResults: [`mx.google.com; dm(x)arc=pass header.from=${FROM}`] },
    ],
    [
      "the dmarc clause names no domain",
      { authResults: ["mx.google.com; dmarc=pass (p=NONE sp=NONE dis=NONE)"] },
    ],
    [
      "the dmarc clause names the domain in quotes",
      { authResults: [`mx.google.com; dmarc=pass header.from="${FROM}"`] },
    ],
    [
      "the dmarc clause names two domains",
      {
        authResults: [`mx.google.com; dmarc=pass header.from=${FROM} header.from=evil.example`],
      },
    ],
    [
      "the dmarc clause holds another word",
      { authResults: [`mx.google.com; dmarc=pass header.from=${FROM} policy.dmarc=none`] },
    ],
    [
      "the dmarc clause names the domain under another property",
      { authResults: [`mx.google.com; dmarc=pass smtp.mailfrom=${FROM}`] },
    ],
    [
      "the domain it names has more written after it",
      { authResults: [`mx.google.com; dmarc=pass header.from=${FROM}=evil.example`] },
    ],
    [
      "the dmarc clause names nothing after header.from",
      { authResults: ["mx.google.com; dmarc=pass header.from="] },
    ],
    ["the pass is for another domain", { authResults: [googleSays("evil.example")] }],
    [
      "the pass is for a parent of the sender's domain",
      { from: [`billing@mail.${FROM}`], authResults: [googleSays(FROM)] },
    ],
    [
      "the pass is for a part under the sender's domain",
      { from: [`billing@${FROM}`], authResults: [googleSays(`mail.${FROM}`)] },
    ],
    [
      "the pass is for an ending the sender's domain shares",
      { from: ["billing@bigco.co.uk"], authResults: [googleSays("co.uk")] },
    ],
    [
      "the pass is for a domain the sender's only ends with",
      { from: ["billing@chase.example"], authResults: [googleSays("ase.example")] },
    ],
    [
      "the pass is for a domain that ends with the sender's",
      { from: ["billing@chase.example"], authResults: [googleSays("evilchase.example")] },
    ],
    [
      "the pass is for a domain that starts with the sender's",
      { from: ["billing@chase.example"], authResults: [googleSays("chase.example.evil.example")] },
    ],
    ["two addresses in the From header", { from: [`billing@${FROM}, x@evil.example`] }],
    [
      "two addresses, the second the checked one",
      {
        from: [`Chase <alerts@chase.example>, <billing@${FROM}>`],
      },
    ],
    [
      "a name outside quotes that holds an address",
      { from: [`alerts@chase.example <billing@${FROM}>`] },
    ],
    ["a name outside quotes with a comma", { from: [`Acme Power, Inc. <billing@${FROM}>`] }],
    ["a group of addresses", { from: [`Billing: billing@${FROM};`] }],
    ["two pairs of brackets", { from: [`Acme <billing@${FROM}> <x@evil.example>`] }],
    ["words after the address", { from: [`<billing@${FROM}> via evil.example`] }],
    ["a closing bracket with no opening one", { from: [`billing@${FROM}>`] }],
    ["a closing bracket before the at sign, with no opening one", { from: [`bill>ing@${FROM}`] }],
    ["an opening bracket before the address, with no closing one", { from: [`<billing@${FROM}`] }],
    ["brackets the wrong way round", { from: [`>billing@${FROM}<`] }],
    ["a quoted string inside the address", { from: [`billing@"x"${FROM}`] }],
    ["a bracket that never closes in the From header", { from: [`Acme <billing@${FROM}`] }],
    ["a quote that never closes in the From header", { from: [`"Acme <billing@${FROM}>`] }],
    ["a quote after the address that never closes", { from: [`<billing@${FROM}> "Acme`] }],
    ["a comment after the address that never closes", { from: [`billing@${FROM} (Acme`] }],
    ["a bracket after the address that closes nothing", { from: [`billing@${FROM} )`] }],
    ["a backslash outside a name's quotes", { from: [`Acme\\ Power <billing@${FROM}>`] }],
    ["an address with two at signs", { from: [`billing@evil.example@${FROM}`] }],
    ["a list written without spaces", { from: [`x,billing@${FROM}`] }],
    ["a group written without spaces", { from: [`team:billing@${FROM}`] }],
    ["a semicolon in the address", { from: [`bill;ing@${FROM}`] }],
    ["an address with a space in it", { from: [`billing team@${FROM}`] }],
    ["an address with no name before the at sign", { from: [`@${FROM}`] }],
    ["no address at all", { from: ["Acme Power"] }],
    [
      "a domain with no dot",
      { from: ["billing@localhost"], authResults: [googleSays("localhost")] },
    ],
    [
      "a domain that ends in a dot",
      { from: [`billing@${FROM}.`], authResults: [googleSays(`${FROM}.`)] },
    ],
    [
      "a domain made of numbers",
      { from: ["billing@203.0.113.9"], authResults: [googleSays("203.0.113.9")] },
    ],
    [
      "an address at a machine's number",
      { from: ["billing@[203.0.113.9]"], authResults: [googleSays("[203.0.113.9]")] },
    ],
    [
      "a domain with a letter from another alphabet",
      {
        from: [`billing@acme-p${char(0x43e)}wer.example`],
        authResults: [googleSays(`acme-p${char(0x43e)}wer.example`)],
      },
    ],
    [
      // The Kelvin sign lowers to a plain k.
      "a domain with a letter that only lowers to a plain one",
      {
        from: [`billing@ban${char(0x212a)}.example`],
        authResults: [googleSays("bank.example")],
      },
    ],
    [
      "a pass for a domain with such a letter",
      {
        from: ["billing@bank.example"],
        authResults: [googleSays(`ban${char(0x212a)}.example`)],
      },
    ],
    [
      "a domain with an underscore",
      { from: ["billing@acme_power.example"], authResults: [googleSays("acme_power.example")] },
    ],
  ];

  it.each(forged)("is refused when %s", (_what, over) => {
    expect(verifiedSender(meta(over))).toBeNull();
  });

  it("checks rows that would each pass with the one thing put right", () => {
    // The table above is only worth something if its base passes.
    expect(verifiedSender(meta())).toBe(FROM);
    expect(
      verifiedSender(
        meta({ from: ["billing@chase.example"], authResults: [googleSays("chase.example")] }),
      ),
    ).toBe("chase.example");
  });
});

describe("the domain a From header names", () => {
  it("is the whole domain, lowered, whatever Google says of it", () => {
    expect(fromDomain(meta({ from: ["Alerts <Alerts@Mail.Comcast.NET>"], authResults: [] }))).toBe(
      "mail.comcast.net",
    );
  });

  it("is null when there isn't exactly one address", () => {
    expect(fromDomain(meta({ from: [] }))).toBeNull();
    expect(fromDomain(meta({ from: ["a@b.example", "a@b.example"] }))).toBeNull();
    expect(fromDomain(meta({ from: ["a@b.example, c@d.example"] }))).toBeNull();
  });
});

const encoded = (text: string | Uint8Array) => Buffer.from(text).toString("base64url");
const part = (mimeType: string, text: string, more: Record<string, unknown> = {}) => ({
  mimeType,
  filename: "",
  headers: [{ name: "Content-Type", value: `${mimeType}; charset="UTF-8"` }],
  body: { size: text.length, data: encoded(text) },
  ...more,
});
const several = (mimeType: string, parts: unknown[]) => ({
  mimeType,
  filename: "",
  body: { size: 0 },
  parts,
});

const RECEIPT = `Thanks for your payment. ${"Your receipt follows, line by line. ".repeat(8)}Total: $84.20`;
const STUB = "View this email in your browser.";
const PAGE = "<p>Total: <b>$84.20</b></p>";

describe("the body of a message", () => {
  it("is the plain text of a one-part email", () => {
    expect(rawBody({ id: "m", payload: part("text/plain", RECEIPT) })).toEqual({
      text: RECEIPT,
      html: false,
    });
  });

  it("is the HTML of an email that has only that, as written", () => {
    expect(rawBody({ id: "m", payload: part("text/html", PAGE) })).toEqual({
      text: PAGE,
      html: true,
    });
  });

  it("is the plain part when both are there and the plain part says something", () => {
    const both = several("multipart/alternative", [
      part("text/plain", RECEIPT),
      part("text/html", PAGE),
    ]);
    expect(rawBody({ payload: both })).toEqual({ text: RECEIPT, html: false });
  });

  it("is the HTML when the plain part is only a stub", () => {
    const both = several("multipart/alternative", [
      part("text/plain", `${STUB} Order 5512.`),
      part("text/html", PAGE),
    ]);
    expect(rawBody({ payload: both })).toEqual({ text: PAGE, html: true });
  });

  it("is the HTML when the plain part is long and holds no digit", () => {
    const wordy = "We have sent you a message. ".repeat(20);
    expect(wordy.length).toBeGreaterThan(GMAIL_LIMITS.plainPartShortChars);
    const both = several("multipart/alternative", [
      part("text/plain", wordy),
      part("text/html", PAGE),
    ]);
    expect(rawBody({ payload: both })).toEqual({ text: PAGE, html: true });
  });

  it("doesn't count spaces toward a plain part's length", () => {
    const padded = `${STUB} 1${" ".repeat(GMAIL_LIMITS.plainPartShortChars)}`;
    const both = several("multipart/alternative", [
      part("text/plain", padded),
      part("text/html", PAGE),
    ]);
    expect(rawBody({ payload: both })?.html).toBe(true);
  });

  it("is a short plain part when there is nothing else", () => {
    expect(rawBody({ payload: part("text/plain", STUB) })).toEqual({ text: STUB, html: false });
  });

  it("finds the text inside parts inside parts", () => {
    const nested = several("multipart/mixed", [
      several("multipart/related", [
        several("multipart/alternative", [part("text/plain", RECEIPT), part("text/html", PAGE)]),
      ]),
    ]);
    expect(rawBody({ payload: nested })).toEqual({ text: RECEIPT, html: false });
  });

  it("takes the first of each kind", () => {
    const two = several("multipart/mixed", [
      part("text/plain", RECEIPT),
      part("text/plain", `${RECEIPT} A second part.`),
    ]);
    expect(rawBody({ payload: two })?.text).toBe(RECEIPT);
  });

  it("never reads an attachment, whatever type it says it is", () => {
    const attached = several("multipart/mixed", [
      part("text/plain", `${RECEIPT} from the attachment`, { filename: "notes.txt" }),
      several("message/rfc822", [part("text/plain", `${RECEIPT} from an attached email`)]),
      part("text/plain", RECEIPT),
    ]);
    // The attached email has a file name on its own part in Gmail's answers.
    (attached.parts[1] as { filename: string }).filename = "forwarded.eml";
    expect(rawBody({ payload: attached })).toEqual({ text: RECEIPT, html: false });
  });

  it("is null for an email whose only text is an attachment", () => {
    const only = several("multipart/mixed", [
      part("text/plain", RECEIPT, { filename: "receipt.txt" }),
      { mimeType: "application/pdf", filename: "receipt.pdf", body: { attachmentId: "a1" } },
    ]);
    expect(rawBody({ payload: only })).toBeNull();
  });

  it("reads a type written in capitals", () => {
    expect(rawBody({ payload: part("TEXT/HTML", PAGE) })?.html).toBe(true);
  });

  it("decodes Gmail's own alphabet, with - and _", () => {
    const text = "Total: $84.20 ?>?>~~ ÿþ";
    expect(encoded(text)).toMatch(/[-_]/);
    expect(rawBody({ payload: part("text/plain", text) })?.text).toBe(text);
  });

  it.each([
    ["in quotes", 'text/plain; charset="ISO-8859-1"'],
    ["bare", "text/plain; charset=iso-8859-1; format=flowed"],
    ["in capitals", "TEXT/PLAIN; CHARSET=ISO-8859-1"],
  ])("decodes by the part's own character set, written %s", (_what, type) => {
    const latin = {
      mimeType: "text/plain",
      headers: [{ name: "content-type", value: type }],
      body: { data: encoded(Buffer.from("Café: $4.50", "latin1")) },
    };
    expect(rawBody({ payload: latin })?.text).toBe("Café: $4.50");
  });

  it.each([
    ["none is named", [{ name: "Content-Type", value: "text/plain" }]],
    ["there are no headers", undefined],
    ["the headers aren't a list", "Content-Type: text/plain"],
    [
      "the one named isn't known here",
      [{ name: "Content-Type", value: "text/plain; charset=x-made-up" }],
    ],
    ["the one named is empty", [{ name: "Content-Type", value: "text/plain; charset=" }]],
    [
      "the one named is very long",
      [{ name: "Content-Type", value: `text/plain; charset=${"z".repeat(50_000)}` }],
    ],
    [
      "the one named stands past the length a header is read to",
      [
        {
          name: "Content-Type",
          value: `text/plain; x=${"y".repeat(GMAIL_LIMITS.headerChars)}; charset=iso-8859-1`,
        },
      ],
    ],
  ])("decodes as UTF-8 when %s", (_what, headers) => {
    const plain = { mimeType: "text/plain", headers, body: { data: encoded("Café: $4.50") } };
    expect(rawBody({ payload: plain })?.text).toBe("Café: $4.50");
  });

  it("cuts a long body to what is ever looked at", () => {
    const long = `Total: $84.20 ${"x".repeat(GMAIL_LIMITS.htmlCharsMost + 5_000)}`;
    const cut = rawBody({ payload: part("text/html", long) });
    expect(cut?.text).toHaveLength(GMAIL_LIMITS.htmlCharsMost);
    expect(cut?.text.startsWith("Total: $84.20 xxx")).toBe(true);
  });

  it("doesn't follow parts deeper than the limit", () => {
    const wrapped = (levels: number) => {
      let inner: unknown = part("text/plain", RECEIPT);
      for (let i = 0; i < levels; i++) inner = several("multipart/mixed", [inner]);
      return { payload: inner };
    };
    expect(rawBody(wrapped(GMAIL_LIMITS.partsDepthMost))?.text).toBe(RECEIPT);
    expect(rawBody(wrapped(GMAIL_LIMITS.partsDepthMost + 1))).toBeNull();
  });

  it("doesn't look at more parts than the limit", () => {
    const filler = (count: number) =>
      Array.from({ length: count }, () => ({ mimeType: "image/png", filename: "", body: {} }));
    const after = (count: number) => ({
      payload: several("multipart/mixed", [...filler(count), part("text/plain", RECEIPT)]),
    });
    // The outer part is one of them.
    expect(rawBody(after(GMAIL_LIMITS.partsMost - 2))?.text).toBe(RECEIPT);
    expect(rawBody(after(GMAIL_LIMITS.partsMost - 1))).toBeNull();
  });

  it.each([
    ["nothing", null],
    ["text", "a message"],
    ["no payload", { id: "m" }],
    ["a payload that isn't a part", { payload: "text/plain" }],
    ["a part with no body", { payload: { mimeType: "text/plain" } }],
    ["a body with no data", { payload: { mimeType: "text/plain", body: { size: 0 } } }],
    ["data that isn't text", { payload: { mimeType: "text/plain", body: { data: 5 } } }],
    [
      "a body kept apart as an attachment",
      { payload: { mimeType: "text/html", body: { attachmentId: "a" } } },
    ],
    ["parts that aren't a list", { payload: { mimeType: "multipart/mixed", parts: "none" } }],
    ["only a picture", { payload: { mimeType: "image/png", body: { data: encoded("png") } } }],
  ])("is null when there is no text to read: %s", (_what, answer) => {
    expect(rawBody(answer)).toBeNull();
  });
});

// One long run of one character made earlier readers in this repository start over from every
// position (src/lib/connectors/tax-upload-crafted-text.test.ts). An email is written by anyone who
// can send one, so each of these has to be read in one pass, or refused at once.
const LONG = 100_000;

function elapsedMs(read: () => unknown): number {
  const start = performance.now();
  read();
  return performance.now() - start;
}

describe("a crafted message is read in one pass", () => {
  it.each([
    ["brackets that open and never close", "(".repeat(LONG)],
    ["quotes", '"'.repeat(LONG)],
    ["backslashes", "\\".repeat(LONG)],
    ["semicolons", `mx.google.com${";".repeat(LONG)}`],
    ["dmarc clauses", `mx.google.com${"; dmarc=pass".repeat(LONG / 10)}`],
    ["one long word", `mx.google.com; dmarc=pass header.from=${"a".repeat(LONG)}`],
    ["folded lines", `mx.google.com;${"\r\n ".repeat(LONG / 3)}dmarc=pass header.from=${FROM}`],
  ])("an Authentication-Results header of %s", (_what, header) => {
    expect(elapsedMs(() => verifiedSender(meta({ authResults: [header] })))).toBeLessThan(250);
    expect(verifiedSender(meta({ authResults: [header] }))).toBeNull();
  });

  it.each([
    ["brackets", "(".repeat(GMAIL_LIMITS.headerChars - 20)],
    ["quotes", '"'.repeat(GMAIL_LIMITS.headerChars - 21)],
    ["nested comments", "(a".repeat((GMAIL_LIMITS.headerChars - 20) / 2)],
    ["spaces", " ".repeat(GMAIL_LIMITS.headerChars - 20)],
  ])("a header of %s that is just inside the limit", (_what, filler) => {
    const header = `mx.google.com; ${filler}`;
    expect(header.length).toBeLessThanOrEqual(GMAIL_LIMITS.headerChars);
    const many = meta({ authResults: [header], from: [`${filler} <billing@${FROM}>`] });
    expect(elapsedMs(() => verifiedSender(many))).toBeLessThan(250);
  });

  it.each([
    ["at signs", "@".repeat(LONG)],
    ["commas", ",".repeat(LONG)],
    ["dots after an address", `billing@${"a.".repeat(LONG / 2)}example`],
    ["angle brackets", "<".repeat(LONG)],
  ])("a From header of %s", (_what, from) => {
    expect(elapsedMs(() => verifiedSender(meta({ from: [from] })))).toBeLessThan(250);
    expect(verifiedSender(meta({ from: [from] }))).toBeNull();
  });

  it("a thousand headers in Google's name", () => {
    const headers = Array.from({ length: 1_000 }, () => googleSays());
    expect(elapsedMs(() => verifiedSender(meta({ authResults: headers })))).toBeLessThan(250);
    expect(verifiedSender(meta({ authResults: headers }))).toBeNull();
  });

  it("a message with a hundred thousand headers", () => {
    const headers = Array.from({ length: LONG }, (_, i) => ({
      name: i % 2 ? "From" : "Authentication-Results",
      value: "x",
    }));
    const raw = { id: "m", payload: { headers } };
    expect(elapsedMs(() => mailMeta(raw))).toBeLessThan(250);
    expect(mailMeta(raw)?.from).toHaveLength(LONG / 2);
  });

  it("a message with a hundred thousand parts", () => {
    const parts = Array.from({ length: LONG }, () => ({ mimeType: "multipart/mixed", parts: [] }));
    const raw = { payload: several("multipart/mixed", [...parts, part("text/plain", RECEIPT)]) };
    expect(elapsedMs(() => rawBody(raw))).toBeLessThan(250);
    expect(rawBody(raw)).toBeNull();
  });

  it("parts nested ten thousand deep", () => {
    let inner: unknown = part("text/plain", RECEIPT);
    for (let i = 0; i < 10_000; i++) inner = several("multipart/mixed", [inner]);
    expect(elapsedMs(() => rawBody({ payload: inner }))).toBeLessThan(250);
    expect(rawBody({ payload: inner })).toBeNull();
  });

  it.each([
    ["spaces after the word charset", `text/plain; charset${" ".repeat(LONG)}=x`],
    ["the word charset over and over", "charset ".repeat(LONG / 8)],
    ["one long name", `text/plain; charset=${"a".repeat(LONG)}`],
  ])("a part whose type holds %s", (_what, type) => {
    const crafted = {
      mimeType: "text/plain",
      headers: [{ name: "Content-Type", value: type }],
      body: { data: encoded(RECEIPT) },
    };
    expect(elapsedMs(() => rawBody({ payload: crafted }))).toBeLessThan(250);
    expect(rawBody({ payload: crafted })?.text).toBe(RECEIPT);
  });

  it("a body as large as an email may be", () => {
    const large = part("text/html", "<".repeat(GMAIL_LIMITS.mailBytesMost));
    expect(elapsedMs(() => rawBody({ payload: large }))).toBeLessThan(250);
  });
});
