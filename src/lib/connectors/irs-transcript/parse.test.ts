import { describe, expect, it } from "vitest";
import { TRANSCRIPT_TEXT } from "./__fixtures__/transcript";
import { parseTranscript } from "./parse";

// Connectors roadmap round 16: the person's own IRS account transcript, read in memory.

describe("parseTranscript", () => {
  it("reads the tax year, the balance and each known transaction, across page breaks", () => {
    const t = parseTranscript(TRANSCRIPT_TEXT);
    expect(t.taxYear).toBe(2025);
    expect(t.balanceCents).toBe(0);
    expect(t.lines).toEqual([
      { code: "150", what: "Return filed", on: "2026-04-15", cents: 432_100 },
      { code: "670", what: "Payment", on: "2026-01-15", cents: -100_000 },
      { code: "806", what: "Withholding", on: "2026-04-15", cents: -480_000 },
      { code: "766", what: "Credit to the account", on: "2026-04-15", cents: -50_000 },
      { code: "846", what: "Refund issued", on: "2026-05-04", cents: 197_900 },
      { code: "971", what: "Notice issued", on: "2026-05-04", cents: 0 },
    ]);
  });

  it("finds rows well past the start of a long file", () => {
    expect(TRANSCRIPT_TEXT.length).toBeGreaterThan(5_000);
    expect(TRANSCRIPT_TEXT.indexOf("971 Notice issued")).toBeGreaterThan(4_000);
    expect(parseTranscript(TRANSCRIPT_TEXT).lines.at(-1)?.code).toBe("971");
  });

  it("keeps nothing that names the person or a return: no name, SSN, address, document or tracking number", () => {
    const kept = JSON.stringify(parseTranscript(TRANSCRIPT_TEXT));
    for (const secret of [
      "TESTPERSON",
      "4417",
      "SAMPLE ST",
      "76221-105-12345-6",
      "108765432109",
      "61,240",
      "6124000",
    ]) {
      expect(kept, secret).not.toContain(secret);
    }
    // Codes Jane doesn't track (570) are left out, and the words are Jane's own.
    expect(kept).not.toContain("570");
    expect(kept).not.toContain("Tax return filed");
  });

  it("reads a negative amount in brackets, and refuses what isn't a transcript", () => {
    const t = parseTranscript(
      "Account Transcript\nTAX PERIOD: Dec. 31, 2024\nACCOUNT BALANCE: ($12.50)\n806 W-2 or 1099 withholding 04-15-2025 ($900.00)\n",
    );
    expect(t).toMatchObject({ taxYear: 2024, balanceCents: -1_250 });
    expect(t.lines[0]).toMatchObject({ code: "806", cents: -90_000 });
    expect(() => parseTranscript("Bank statement\n150 something 04-15-2026 $1.00")).toThrow(
      /transcript heading/,
    );
    expect(() => parseTranscript("Account Transcript\nnothing here")).toThrow(/no tax period/);
    expect(() => parseTranscript(`Account Transcript\n${"x".repeat(2_000_001)}`)).toThrow(
      /too large/,
    );
  });
});
