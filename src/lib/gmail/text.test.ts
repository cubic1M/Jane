import { describe, expect, it } from "vitest";
import { GMAIL_LIMITS } from "@/config/gmail";
import { carriesSecret, forReader, htmlToText, subjectForReader } from "./text";

// An email's words, made ready for the reader: HTML to text, what Claude may see of it, and whether
// it gives away a code or a password. The sender writes all of it, at any length.

// Characters that can't be seen in a source file are made here, by number.
const char = (code: number) => String.fromCharCode(code);
const NO_BREAK_SPACE = char(0xa0);
const THIN_SPACE = char(0x2009);
const NARROW_SPACE = char(0x202f);
const WIDE_SPACE = char(0x3000);
const LINE_SEPARATOR = char(0x2028);
const ZERO_WIDTH = char(0x200b);
const ZERO_WIDTH_JOINER = char(0x200d);
const SOFT_HYPHEN = char(0xad);
const RIGHT_TO_LEFT = char(0x202e);
const BYTE_ORDER_MARK = char(0xfeff);

const { bodyHeadChars: HEAD, bodyTailChars: TAIL, htmlCharsMost: MOST } = GMAIL_LIMITS;

describe("an HTML body as words", () => {
  it("ends a line at the end of a block and of a table cell", () => {
    const table =
      "<table><tr><td>Total</td><td>$15.49</td></tr><tr><td>Tax</td><td>$1.20</td></tr></table>";
    expect(htmlToText(table)).toBe("Total\n$15.49\nTax\n$1.20");
    expect(htmlToText("<h1>Receipt</h1><p>Thanks</p><ul><li>One<li>Two</ul><div>End</div>")).toBe(
      "Receipt\nThanks\nOne\nTwo\nEnd",
    );
    expect(htmlToText("Line one<br>Line two<br/>Line three<BR />four")).toBe(
      "Line one\nLine two\nLine three\nfour",
    );
  });

  it("makes any other tag a space, so the words either side never join", () => {
    expect(htmlToText("<p>Hello<b>World</b>and<span>more</span></p>")).toBe("Hello World and more");
    // Cents set apart in their own tag must not read as $1549.
    expect(htmlToText("You paid <span>$15</span><sup>49</sup>")).toBe("You paid $15 49");
    expect(htmlToText("a<o:p>b</o:p>c<x-custom>d")).toBe("a b c d");
  });

  it("leaves out a script and a style with all inside them", () => {
    const page =
      "<html><head><style>p { margin: 0 } .total::after { content: '$99.99' }</style>" +
      "<script>var total = '<p>$88.88</p>';</script><title>Your receipt</title></head>" +
      "<body><STYLE>b{}</STYLE><Script type='x'>1 < 2</SCRIPT>Total: $15.49</body></html>";
    expect(htmlToText(page)).toBe("Your receipt\nTotal: $15.49");
  });

  it("leaves out comments, the kind mail programs hide markup in too", () => {
    expect(htmlToText("a<!-- hidden <b>$1.00</b> -->b<!--[if mso]><p>$2.00</p><![endif]-->c")).toBe(
      "a b c",
    );
    expect(htmlToText("shown<!-- never closed $3.00")).toBe("shown");
  });

  it("turns entities into their characters, named and numbered", () => {
    expect(htmlToText("Fish &amp; Chips &lt;now&gt; &quot;hot&quot; &apos;n&apos;")).toBe(
      "Fish & Chips <now> \"hot\" 'n'",
    );
    expect(htmlToText("&#36;15.49 &#x24;16.00 &#X24;17.00 &dollar;18.00")).toBe(
      "$15.49 $16.00 $17.00 $18.00",
    );
    expect(htmlToText("&euro;5 &pound;6 &yen;7 &cent;8 &copy; &reg; &trade;")).toBe(
      "€5 £6 ¥7 ¢8 © ® ™",
    );
    expect(htmlToText("caf&#233; &#x1F600; &NBSP;&Amp;")).toBe("café 😀 &");
  });

  it("makes a no-break space a space", () => {
    expect(htmlToText("Total:&nbsp;&nbsp;$15.49&#160;USD&ensp;now")).toBe("Total: $15.49 USD now");
  });

  it("decodes once: what was written as text stays text", () => {
    expect(htmlToText("&amp;lt;script&amp;gt; and &amp;#36;5")).toBe("&lt;script&gt; and &#36;5");
    expect(htmlToText("&lt;script&gt;alert(1)&lt;/script&gt; after")).toBe(
      "<script>alert(1)</script> after",
    );
  });

  it("leaves a name it doesn't know as written, and makes a number that is no character a space", () => {
    expect(htmlToText("a &bogus; b &constructor; c &toString; d")).toBe(
      "a &bogus; b &constructor; c &toString; d",
    );
    expect(htmlToText("x&#0;y&#31;z&#55357;w&#1114112;v&#128;u")).toBe("x y z w v u");
    expect(htmlToText("AT&T and R&D; 5 & 6")).toBe("AT&T and R&D; 5 & 6");
  });

  it("keeps a < that doesn't start a tag", () => {
    expect(htmlToText("5 < 6 and 7 > 3, I <3 it, a <= b")).toBe("5 < 6 and 7 > 3, I <3 it, a <= b");
    expect(htmlToText("ends with <")).toBe("ends with <");
  });

  it("reads a > inside a quoted attribute as part of the tag", () => {
    const link =
      '<a title="a > b" href="https://pay.example/?q=1">Pay now</a> <img alt=\'5" > 4"\'>after';
    expect(htmlToText(link)).toBe("Pay now after");
    // A quote that doesn't start a value is only a character.
    expect(htmlToText("<p class=it's>Total: $5</p> it's due")).toBe("Total: $5\nit's due");
  });

  it("never lets a link's address into the words", () => {
    const text = htmlToText('<a href="https://pay.example/inv?token=secret123">Pay your bill</a>');
    expect(text).toBe("Pay your bill");
    expect(text).not.toMatch(/pay\.example|secret123/);
  });

  it("lets a tag that never closes take the rest with it, as a browser does", () => {
    expect(htmlToText("before <a href='x' and the rest")).toBe("before");
    expect(htmlToText("before <script>var rest = 'gone';")).toBe("before");
    expect(htmlToText('before <a href="never closed>and the rest</a>')).toBe("before");
  });

  it("makes every run of spaces one space, and every run with a line break one line break", () => {
    expect(htmlToText("  a \n\n\n b \t c\r\n d  ")).toBe("a\nb c\nd");
    expect(htmlToText("<p>  one  </p>\n\n<p>\ttwo</p>")).toBe("one\ntwo");
  });

  it("is cut to what is ever looked at, before anything is read", () => {
    const long = `<p>start</p>${"<i>x</i> ".repeat(MOST / 9)}<p>THE-END</p>`;
    expect(long.length).toBeGreaterThan(MOST);
    const text = htmlToText(long);
    expect(text.startsWith("start\nx x x")).toBe(true);
    expect(text).not.toContain("THE-END");
  });

  it("is empty for nothing, and for markup with no words", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("<html><body><img src='x.png'><br></body></html>")).toBe("");
  });
});

describe("what Claude may see of a body", () => {
  it("replaces every link", () => {
    expect(forReader("Pay at https://pay.example/inv?token=abc&x=1#top now")).toBe(
      "Pay at [link] now",
    );
    expect(forReader("see http://a.example, WWW.Acme.Example/pay and HTTPS://B.EXAMPLE")).toBe(
      "see [link] [link] and [link]",
    );
    expect(forReader("open myapp://reset?code=1 or ftp://files.example/x")).toBe(
      "open [link] or [link]",
    );
    expect(forReader('<https://a.example/b> "https://c.example"')).toBe('<[link]> "[link]"');
  });

  it("replaces all of a link that holds an apostrophe", () => {
    expect(forReader("Reset: https://pay.example/r?name=O'Brien&token=abc now")).toBe(
      "Reset: [link] now",
    );
    expect(forReader("See www.acme.example/o'brien/pay?token=abc now")).toBe("See [link] now");
  });

  it("replaces a link that runs on from the word or the number before it", () => {
    expect(forReader("Order 12345https://track.example/t?token=abc shipped")).toBe(
      "Order 12345[link] shipped",
    );
    expect(forReader("see_http://a.example/x, 2026-11-18www.acme.example/pay?id=1 now")).toBe(
      "see_[link] 2026-11-18[link] now",
    );
    expect(forReader("View your receipthttps://pay.example/r?token=abc")).toBe("View your [link]");
    // A word longer than any scheme: the link still goes, with as much of the word as a scheme holds.
    const run = forReader("confirmationnumberhttps://pay.example/reset?token=abc now");
    expect(run).toBe("co[link] now");
    expect(forReader(`${"a".repeat(60)}://token-abc now`)).not.toMatch(/token|:\/\//);
  });

  it("leaves a company's bare name alone", () => {
    expect(forReader("Thanks for shopping at acme.example today.")).toBe(
      "Thanks for shopping at acme.example today.",
    );
    // A word that only ends in the letters a web address starts with.
    expect(forReader("Awww... thanks for your payment!")).toBe("Awww... thanks for your payment!");
  });

  it("replaces every address, whoever's it is", () => {
    expect(forReader("Sent to first.last+shop@gmail.com by billing@acme.example")).toBe(
      "Sent to [address] by [address]",
    );
    expect(forReader("Write <help@acme.example>, or mailto:help123@acme.example.")).toBe(
      "Write [address] or [address]",
    );
    expect(forReader("a@b.c")).toBe("[address]");
  });

  it("leaves an @ that isn't an address", () => {
    expect(forReader("Follow @acme, 2 @ $5.00 each, user@host")).toBe(
      "Follow @acme, 2 @ $5.00 each, user@host",
    );
    expect(forReader("Find us @acme.example")).toBe("Find us @acme.example");
  });

  it("replaces a long row of digits, from the limit up", () => {
    const { longNumberDigits } = GMAIL_LIMITS;
    expect(forReader(`Account ${"7".repeat(longNumberDigits)} on file`)).toBe(
      "Account [number] on file",
    );
    expect(forReader(`Order ${"7".repeat(longNumberDigits - 1)} shipped`)).toBe(
      `Order ${"7".repeat(longNumberDigits - 1)} shipped`,
    );
    expect(forReader("IBAN DE89370400440532013000 ref A123456789012Z")).toBe(
      "IBAN DE[number] ref A[number]Z",
    );
  });

  it.each([
    ["spaces", "4111 1111 1111 1111"],
    ["dashes", "4111-1111-1111-1111"],
    ["both", "4111 1111-1111 1111"],
    ["no-break spaces", ["4111", "1111", "1111", "1111"].join(NO_BREAK_SPACE)],
    ["thin spaces", ["4111", "1111", "1111", "1111"].join(THIN_SPACE)],
    ["nothing that shows", ["4111", "1111", "1111", "1111"].join(ZERO_WIDTH)],
    ["soft hyphens", ["4111", "1111", "1111", "1111"].join(SOFT_HYPHEN)],
    ["five groups", "4111 1111 1111 1111 2222"],
  ])("replaces a card number written in groups of four with %s between", (_what, card) => {
    expect(forReader(`Card ${card} charged`)).toBe("Card [number] charged");
  });

  it("replaces a card number an HTML email split up to stop a phone linking it", () => {
    const html = "<p>Card 4111&#8203;1111&#8203;1111&#8203;1111 charged</p>";
    expect(forReader(htmlToText(html))).toBe("Card [number] charged");
    const cells = "<p>Card 4111&nbsp;1111&nbsp;1111&nbsp;1111 charged</p>";
    expect(forReader(htmlToText(cells))).toBe("Card [number] charged");
  });

  it("keeps no digit of a number it replaced", () => {
    const text = forReader(
      "Account 000123456789, card 4111-1111-1111-1111, ref 98765432109876543210, 123456789",
    );
    expect(text).toBe("Account [number], card [number], ref [number], [number]");
    expect(text).not.toMatch(/\d/);
  });

  it("replaces a long number with the decimals written after it, so none can pass for an amount", () => {
    const text = forReader("Account 000123456789.00 paid $123456789.49, ref 987654321,12.");
    expect(text).toBe("Account [number] paid $[number], ref [number].");
    expect(text).not.toMatch(/\d/);
    const card = forReader("Card 4111 1111 1111 1111.00 on file, 4111-1111-1111-1111,50 too");
    expect(card).toBe("Card [number] on file, [number] too");
    // A full stop or a comma that only ends a sentence or a clause is left where it is.
    expect(forReader("Your account is 123456789. $15.49 is due, on card 123456789, today.")).toBe(
      "Your account is [number]. $15.49 is due, on card [number], today.",
    );
  });

  it.each([
    ["a comma", "4111 1111 1111 1111,4222 2222 2222 2222", "[number],[number]"],
    ["a full stop", "4111-1111-1111-1111.4222-2222-2222-2222", "[number].[number]"],
  ])("replaces both of two card numbers with only %s between", (_what, cards, both) => {
    expect(forReader(`Cards ${cards} on file`)).toBe(`Cards ${both} on file`);
  });

  it.each([
    "On 2026-11-18 you paid $1,234.56.",
    "Order 4521 2026-11-03 15.49",
    "Due 2026-12-01 150.00",
    "Paid 11/18/2026 at 10:32 AM",
    "Call 1-800-555-0199 or (415) 555-0142",
    "Card ending 1234, three groups 4111 1111 1111",
    "Total: $84.20 (12345678 points, 3.5% back)",
    "ZIP 94105-1234, order #12345678",
  ])("leaves dates, amounts and short numbers as written: %s", (text) => {
    expect(forReader(text)).toBe(text);
  });

  it("makes every kind of space a plain space", () => {
    const spaced = ["Total:", "$84.20", "due", "Dec", "1"].join(NO_BREAK_SPACE);
    expect(forReader(spaced)).toBe("Total: $84.20 due Dec 1");
    expect(
      forReader(`a${THIN_SPACE}b${NARROW_SPACE}c${WIDE_SPACE}d${LINE_SEPARATOR}e\tf\r\ng`),
    ).toBe("a b c d e f \ng");
  });

  it("takes out what can't be seen, and what turns the text around", () => {
    const hidden = `Pay${ZERO_WIDTH}ment of $8${ZERO_WIDTH_JOINER}4.20${RIGHT_TO_LEFT} due${BYTE_ORDER_MARK}${SOFT_HYPHEN}${char(0)}${char(0x7f)}`;
    expect(forReader(hidden)).toBe("Payment of $84.20 due");
  });

  it("gives a short body whole", () => {
    const body = `Thanks.\n\nTotal: $84.20\n${"line\n".repeat(100)}`;
    expect(body.length).toBeLessThan(HEAD + TAIL);
    expect(forReader(body)).toBe(body);
  });

  it("gives the start and the end of a long body, and says the middle was left out", () => {
    const body = `Order received. ${"item and price, ".repeat(2_000)}Total: $84.20 end.`;
    const seen = forReader(body);
    expect(seen.startsWith("Order received. item and price,")).toBe(true);
    // A receipt's total comes after its items.
    expect(seen.endsWith("item and price, Total: $84.20 end.")).toBe(true);
    expect(seen.split("\n[...]\n")).toHaveLength(2);
    expect(seen.length).toBeLessThanOrEqual(HEAD + TAIL + "\n[...]\n".length);
    expect(seen.length).toBeGreaterThan(HEAD + TAIL - 40);
  });

  it("never cuts a figure in half at either end", () => {
    const before = "x ".repeat((HEAD - 4) / 2);
    const after = "y ".repeat((TAIL - 4) / 2);
    const body = `${before}$1,234.56 ${"middle ".repeat(1_000)}$9,876.54 ${after}`;
    // As written, the cuts fall inside both figures.
    expect(body.slice(0, HEAD)).toMatch(/\$1,2$/);
    expect(body.slice(-TAIL)).toMatch(/^\.54 /);
    const [start, end] = forReader(body).split("\n[...]\n");
    expect(start).toBe(before.trimEnd());
    expect(end).toBe(after);
    expect(`${start}${end}`).not.toMatch(/\d/);
  });

  it("cuts one long run of characters where it must", () => {
    const seen = forReader("z".repeat(HEAD + TAIL + 1_000));
    expect(seen).toBe(`${"z".repeat(HEAD)}\n[...]\n${"z".repeat(TAIL)}`);
  });

  it("never leaves half of a two-part character", () => {
    const body = `${"z".repeat(HEAD - 1)}😀${"z".repeat(TAIL + 1_000)}`;
    expect(body.slice(0, HEAD).isWellFormed()).toBe(false);
    expect(forReader(body).isWellFormed()).toBe(true);
    expect(forReader(`ok ${char(0xd83d)} lone`).isWellFormed()).toBe(true);
  });

  it("is cut to what is ever looked at before any replacement runs", () => {
    const body = `${"word ".repeat(MOST / 5)}https://late.example/THE-END 4111 1111 1111 1111`;
    const seen = forReader(body);
    expect(seen).not.toMatch(/THE-END|\[link\]|\[number\]/);
    expect(seen.endsWith("word word word ")).toBe(true);
  });
});

describe("what Claude may see of a subject", () => {
  it("goes through the same replacements, on one line", () => {
    const subject = `Re: your order\r\n confirmation${NO_BREAK_SPACE}for billing@acme.example https://x.example 123456789 $15.49`;
    expect(subjectForReader(subject)).toBe(
      "Re: your order confirmation for [address] [link] [number] $15.49",
    );
  });

  it("takes out what can't be seen", () => {
    expect(subjectForReader(`Your rec${ZERO_WIDTH}eipt${RIGHT_TO_LEFT}`)).toBe("Your receipt");
  });

  it("is no longer than a subject is read, and ends between words", () => {
    const { subjectChars } = GMAIL_LIMITS;
    const long = `Receipt ${"and more words ".repeat(40)}`;
    const seen = subjectForReader(long);
    expect(seen.length).toBeLessThanOrEqual(subjectChars);
    expect(seen.length).toBeGreaterThan(subjectChars - 20);
    expect(seen.endsWith("words") || seen.endsWith("more") || seen.endsWith("and")).toBe(true);
    expect(subjectForReader("z".repeat(subjectChars + 50))).toHaveLength(subjectChars);
  });

  it("never cuts a figure in half", () => {
    const { subjectChars } = GMAIL_LIMITS;
    const subject = `${"x ".repeat((subjectChars - 4) / 2)}$1,234.56 and the rest`;
    expect(subject.slice(0, subjectChars)).toMatch(/\$1,2$/);
    expect(subjectForReader(subject)).not.toMatch(/\d/);
  });

  it("never leaves half of a two-part character", () => {
    const { subjectChars } = GMAIL_LIMITS;
    const subject = `${"z".repeat(subjectChars - 1)}😀 and more`;
    expect(subject.slice(0, subjectChars).isWellFormed()).toBe(false);
    expect(subjectForReader(subject).isWellFormed()).toBe(true);
    expect(subjectForReader(`Receipt ${char(0xd83d)} lone`).isWellFormed()).toBe(true);
  });
});

describe("a code or a password given in the text", () => {
  it.each([
    "Your verification code is 482913",
    "Your Acme verification code: 482913.",
    "YOUR VERIFICATION CODE IS 482913",
    "Your one-time passcode: 4829",
    "Your one time passcode is 482913",
    "Your one time code is 482913",
    "Your two factor code is 482913",
    "Your two step code: 482913",
    "Security code: 482 913",
    "Security code: 482-913",
    `Verification code:${NO_BREAK_SPACE}482913`,
    "Use verification code 482913 to finish signing in.",
    "Use this code to sign in: 123456",
    "Use this code to finish signing in: 482913",
    "Your code for logging in is 482913",
    "Enter this code to verify your identity: 482913",
    "Your code for two-step verification is 482913",
    "Your code to log in to Acme: 482913",
    "Enter code 482913 to sign in",
    "Use code 482913 to verify your identity.",
    "Code 482913 for two-step verification",
    "Your one-time password is 482913",
    "One time password: 4829",
    "Your sign in code is 12345678",
    "Your sign-in code - 482913",
    "Use 2FA code 482913",
    "Authentication code: 482913",
    "Your login verification code is *482913*",
    'Your security code is "482913".',
    "Your access code is 4521",
    "Your PIN is 4829",
    "Enter PIN code 4829",
    "Use OTP code 482913",
    "PIN: 4829",
    "Your OTP is 482913",
    "Your passcode for Acme Online Banking is 482913",
    // Other figures between the code's name and its digits.
    "Your verification code (valid for 10 minutes) is 482913",
    "Your verification code, valid for 10 minutes, is: 482913",
    "Your one-time passcode for your purchase of $50.00 at Amazon is 482913",
    "Verification code for your $25.00 order: 482913",
    "Your PIN for card ending 1234 is 5678",
    "Your login code\n\n482913",
    "Here is your login code.\n\n482913\n\nIt expires in 10 minutes.",
    "Your verification code is below.\n482913",
    "Verify your sign-in. Your code is 482913.",
    "Your verification code is G-482913",
    "G-482913 is your Google verification code",
    "482913 is your Acme verification code.",
    "482 913 is your one-time passcode",
    "Your temporary password is below",
    "We set a temporary password for you.",
    "Your password is Xy7!abc",
    "Your new password is: hunter2",
  ])("is found in: %s", (text) => {
    expect(carriesSecret(text)).toBe(true);
  });

  it.each([
    // What a receipt, a booking or an offer calls a code.
    "Confirmation code: 482913",
    "Your flight is booked. Confirmation code: X7TQ2",
    "Use promo code 2026 at checkout",
    "Promotional code: 482913",
    "Billing ZIP code: 94105",
    "Postal code 90210",
    "Area code 415",
    "Order code 482913",
    "Booking code 482913",
    "Discount code: 5000",
    "Coupon code 482913",
    "For your security, your zip code 94105 was checked",
    "Sign in to view your statement. Approval code: 004521",
    "Enter code 4521 to track your order",
    "Use code 2026 for 20% off your next purchase",
    "Promo code 2026 for access to the sale",
    // Mentioned, not given.
    "We will never ask for your password or verification code.",
    "We will never ask for your password or verification code. © 2026 Acme Bank",
    "Never share your password, your PIN or a one-time passcode with anyone.",
    "For your security, never share your one-time passcode. Call 1-800-555-0199.",
    "If you forgot your password, you can reset it at any time.",
    "Enter the PIN on the back of your card.",
    "Use your PIN at any of our 4000 ATMs",
    "Never share your one-time password with anyone.",
    "Your one-time password expires in 10 minutes.",
    "A verification code is required for payments over 5000 dollars.",
    "Your security code was sent on November 18, 2026",
    "Security code expires 2026-11-18",
    "Your access code is valid until 12/31/2026",
    // Digits that aren't a code.
    "Total $4829.00, security code on file",
    "Security code: $4829",
    "Verification code: 123",
    "Verification code: 4829.50",
    "Verification code: 123456789",
    "Verification code: [number]",
    "Your verification code is 482913abc",
    "$5000 is your one-time passcode limit",
    // Words that only hold the letters.
    "Spin: 4829 points",
    "Pinned: 4829 posts",
    "Use your PIN on this 4829 keypad",
    "Pinterest 2026 highlights",
    "Opinion 4829",
    "Barcode 482913 scanned",
    "Postcode 482913",
    "Your receipt: 1 x Decoder 4829",
    "",
  ])("isn't found in: %s", (text) => {
    expect(carriesSecret(text)).toBe(false);
  });

  it("is found from the shortest code to the longest, and no further", () => {
    const { codeDigitsLeast, codeDigitsMost } = GMAIL_LIMITS;
    const code = (digits: number) => `Your verification code is ${"7".repeat(digits)}`;
    expect(carriesSecret(code(codeDigitsLeast))).toBe(true);
    expect(carriesSecret(code(codeDigitsMost))).toBe(true);
    expect(carriesSecret(code(codeDigitsLeast - 1))).toBe(false);
    expect(carriesSecret(code(codeDigitsMost + 1))).toBe(false);
  });

  it("says yes to a text too long to look through, so it is never sent unread", () => {
    const fine = "Your bill is ready. ".repeat(GMAIL_LIMITS.htmlCharsMost / 20);
    expect(fine).toHaveLength(GMAIL_LIMITS.htmlCharsMost);
    expect(carriesSecret(fine)).toBe(false);
    expect(carriesSecret(`${fine}.`)).toBe(true);
  });

  it("is found in a body after its markup is gone", () => {
    const html =
      "<p>Use this code to finish signing in:</p><table><tr><td><b>482913</b></td></tr></table>" +
      "<p>If you didn't ask for a verification code, ignore this email.</p>";
    expect(carriesSecret(forReader(htmlToText(html)))).toBe(true);
    // The same email about an order: the code it gives signs no one in, and the one it only
    // mentions is given nowhere.
    const order = html.replace("to finish signing in", "to track your order");
    expect(carriesSecret(forReader(htmlToText(order)))).toBe(false);
    const named = order.replace("Use this code", "Use this verification code");
    expect(carriesSecret(forReader(htmlToText(named)))).toBe(true);
  });
});

// One long run of one character made earlier readers in this repository start over from every
// position (src/lib/connectors/tax-upload-crafted-text.test.ts). These are each read in one pass.
const LONG = 100_000;

function elapsedMs(read: () => unknown): number {
  const start = performance.now();
  read();
  return performance.now() - start;
}

describe("crafted text is read in one pass", () => {
  it.each([
    ["tags that open and never close", "<".repeat(LONG)],
    ["the start of a tag, over and over", "<a".repeat(LONG / 2)],
    ["closed tags", "<a>".repeat(LONG / 3)],
    ["a script that never closes", `<script>${"x".repeat(LONG)}`],
    ["a script full of half-closing tags", `<script>${"</".repeat(LONG / 2)}`],
    ["scripts one after another", "<script></script>".repeat(LONG / 17)],
    ["a style that never closes", `<style>${"</styl".repeat(LONG / 6)}`],
    ["comments that never close", "<!--".repeat(LONG / 4)],
    ["a comment full of dashes", `<!--${"-".repeat(LONG)}`],
    ["a tag full of quotes", `<a ${'="'.repeat(LONG / 2)}`],
    ["a tag with one quote and no end", `<a x="${"y".repeat(LONG)}`],
    ["a tag with a very long name", `<${"a".repeat(LONG)}>`],
    ["ampersands", "&".repeat(LONG)],
    ["entities with no end", "&#".repeat(LONG / 2)],
    ["entities", "&amp;".repeat(LONG / 5)],
    ["spaces", " ".repeat(LONG)],
    ["line breaks", "\n".repeat(LONG)],
    ["spaces and line breaks", " \n".repeat(LONG / 2)],
    ["line break tags", "<br>".repeat(LONG / 4)],
  ])("HTML of %s", (_what, html) => {
    expect(elapsedMs(() => htmlToText(html))).toBeLessThan(250);
  });

  it.each([
    ["one long word", "a".repeat(LONG)],
    ["at signs", "@".repeat(LONG)],
    ["a name before every at sign", "a@".repeat(LONG / 2)],
    ["one long address", `${"a".repeat(LONG / 2)}@${"b.".repeat(LONG / 4)}`],
    ["dots", ".".repeat(LONG)],
    ["letters and dots", "a.".repeat(LONG / 2)],
    ["digits", "1".repeat(LONG)],
    ["groups of four digits", "1234 ".repeat(LONG / 5)],
    ["groups of four digits with dashes", "1234-".repeat(LONG / 5)],
    ["card numbers with decimals", "1234 1234 1234 1234.12 ".repeat(LONG / 23)],
    ["three digits and a space", "123 ".repeat(LONG / 4)],
    ["digits and points", "1.".repeat(LONG / 2)],
    ["long numbers with decimals", "123456789.12 ".repeat(LONG / 13)],
    ["a long number and a row of decimals", `123456789${".1".repeat(LONG / 2)}`],
    ["the start of a link", "http://".repeat(LONG / 7)],
    ["links run on from a word", "receipthttps://a.example ".repeat(LONG / 25)],
    ["www", "www.".repeat(LONG / 4)],
    ["a scheme that never ends", `${"a".repeat(LONG)}://`],
    ["colons and slashes", "a://".repeat(LONG / 4)],
    ["spaces", " ".repeat(LONG)],
    ["no-break spaces", NO_BREAK_SPACE.repeat(LONG)],
    ["characters that can't be seen", ZERO_WIDTH.repeat(LONG)],
    ["line breaks", "\n".repeat(LONG)],
    ["half characters", char(0xd83d).repeat(LONG)],
  ])("a body or a subject of %s", (_what, text) => {
    expect(elapsedMs(() => forReader(text))).toBeLessThan(250);
    expect(elapsedMs(() => subjectForReader(text))).toBeLessThan(250);
  });

  it.each([
    ["the word pin", "pin ".repeat(LONG / 4)],
    ["the word code", "code ".repeat(LONG / 5)],
    ["codes named over and over", "verification code ".repeat(LONG / 18)],
    ["a code named and never given", `verification code ${"a ".repeat(LONG / 2)}`],
    ["codes with a colon and no digits", "pin: ".repeat(LONG / 5)],
    ["codes with one digit after", "pin 1 ".repeat(LONG / 6)],
    ["short numbers", "1234 ".repeat(LONG / 5)],
    ["numbers that are someone's", "1234 is your ".repeat(LONG / 13)],
    ["digits", "1".repeat(LONG)],
    ["the word temporary", "temporary ".repeat(LONG / 10)],
    ["the words your password", "your password ".repeat(LONG / 14)],
    ["the words sign in", "sign in ".repeat(LONG / 8)],
    ["code to, and words", `code to ${"sign ".repeat(LONG / 5)}`],
    ["codes given, and words after them", "code 1234 to x ".repeat(LONG / 15)],
    ["codes with figures and a colon after them", "pin 1.5: 123456789 ".repeat(LONG / 19)],
    ["one long word", "a".repeat(LONG)],
    ["spaces", " ".repeat(LONG)],
    ["full stops", "pin. ".repeat(LONG / 5)],
  ])("a text of %s, looked through for a code", (_what, text) => {
    expect(elapsedMs(() => carriesSecret(text))).toBeLessThan(250);
    expect(carriesSecret(text)).toBe(false);
  });
});
