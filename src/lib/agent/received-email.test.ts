import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { htmlToText, readReceivedEmail } from "./received-email";

// An HTML-only reply from a company (Resend sends text: null) is read from its HTML, so the
// reply reader never gets just the subject line (CodeRabbit sweep part 2, chunk act-03b).

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-key-not-real");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const answer = (body: Record<string, unknown>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );

describe("readReceivedEmail", () => {
  it("falls back to the text of the HTML when there is no text part", async () => {
    answer({
      from: "support@co.example",
      to: ["jane@in.example"],
      subject: "Re: your request",
      text: null,
      html: "<style>p{color:red}</style><p>We&#39;ve <b>approved</b> your refund &amp; closed the case.</p><p>Thanks</p>",
    });
    const mail = await readReceivedEmail("abc123");
    expect(mail?.text).toContain("approved your refund & closed the case.");
    expect(mail?.text).not.toMatch(/[<>]|color:red/);
  });

  it("keeps the text part when there is one", async () => {
    answer({ subject: "s", text: "Plain words", html: "<p>Other words</p>" });
    expect((await readReceivedEmail("abc123"))?.text).toBe("Plain words");
  });
});

describe("htmlToText", () => {
  it("breaks lines at paragraphs and drops tags", () => {
    expect(htmlToText("<p>One</p><p>Two<br>three</p>")).toBe("One\nTwo\nthree");
    expect(htmlToText("We&#39;ve refunded &#36;19&#46;99 &#x26; more")).toBe(
      "We've refunded $19.99 & more",
    );
  });

  it("decodes each reference once", () => {
    expect(htmlToText("<p>Pay &amp;#36;5 &#36;5 &amp;amp;</p>")).toBe("Pay &#36;5 $5 &amp;");
  });
});
