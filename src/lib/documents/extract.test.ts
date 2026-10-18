import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDocumentFacts } from "./extract";

const PDF = Buffer.from("%PDF-1.7\n");

const answer = (fields: Record<string, string>) => ({
  stop_reason: "end_turn",
  content: [
    {
      type: "text",
      text: JSON.stringify({
        provider: "",
        policyType: "",
        coverageSummary: "",
        premium: "",
        premiumFrequency: "",
        renewalDate: "",
        warrantyEndsOn: "",
        purchaseDate: "",
        purchaseAmount: "",
        ...fields,
      }),
    },
  ],
});

function fakeClaude(response: unknown) {
  const create = vi.fn(async () => response);
  return { create, claude: (() => ({ messages: { create } })) as never };
}

describe("reading a document's facts with Claude (spec step 68)", () => {
  beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-key"));
  afterEach(() => vi.unstubAllEnvs());

  it("sends the file and reads the facts back", async () => {
    const { create, claude } = fakeClaude(
      answer({
        provider: "GEICO",
        policyType: "auto",
        coverageSummary: "Covers two cars with collision and comprehensive coverage.",
        premium: "612.00",
        premiumFrequency: "semiannual",
        renewalDate: "2027-03-01",
        purchaseDate: "2020-01-01",
      }),
    );

    const result = await readDocumentFacts(
      { bytes: PDF, contentType: "application/pdf", kind: "insurance_policy" },
      { claude },
    );

    expect(result).toEqual({
      kind: "claude",
      summaryRejected: false,
      facts: {
        provider: "GEICO",
        policyType: "auto",
        coverageSummary: "Covers two cars with collision and comprehensive coverage.",
        premiumCents: 61_200,
        premiumFrequency: "semiannual",
        renewalDate: new Date("2027-03-01T00:00:00Z"),
        // A purchase date doesn't belong on a policy, so it's left out.
        warrantyEndsOn: null,
        purchaseDate: null,
        purchaseAmountCents: null,
      },
    });
    const request = (create.mock.calls[0] as unknown[])[0] as Anthropic.MessageCreateParams;
    const content = request.messages[0].content as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: PDF.toString("base64") },
    });
    expect(request.output_config?.format?.type).toBe("json_schema");
  });

  it("sends photos as images", async () => {
    const { create, claude } = fakeClaude(answer({ provider: "Target", purchaseAmount: "89.99" }));
    const result = await readDocumentFacts(
      { bytes: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg", kind: "receipt" },
      { claude },
    );
    expect(result).toMatchObject({ kind: "claude", facts: { purchaseAmountCents: 8_999 } });
    const request = (create.mock.calls[0] as unknown[])[0] as Anthropic.MessageCreateParams;
    expect((request.messages[0].content as Anthropic.ContentBlockParam[])[0]).toMatchObject({
      type: "image",
      source: { media_type: "image/jpeg" },
    });
  });

  it("drops a summary that fails the guardrails and keeps the other facts", async () => {
    for (const summary of [
      "Bodily injury liability up to the state minimum.",
      "You should invest the savings in an index fund.",
      "Covers your car with a $500 deductible.",
    ]) {
      const { claude } = fakeClaude(
        answer({
          provider: "Progressive",
          coverageSummary: summary,
          premium: "150",
          premiumFrequency: "monthly",
        }),
      );
      const result = await readDocumentFacts(
        { bytes: PDF, contentType: "application/pdf", kind: "insurance_policy" },
        { claude },
      );
      expect(result, summary).toMatchObject({
        kind: "claude",
        summaryRejected: true,
        facts: { provider: "Progressive", coverageSummary: null, premiumCents: 15_000 },
      });
    }
  });

  it("allows the document's own price in the summary", async () => {
    const { claude } = fakeClaude(
      answer({ coverageSummary: "A blender for $89.99.", purchaseAmount: "89.99" }),
    );
    const result = await readDocumentFacts(
      { bytes: PDF, contentType: "application/pdf", kind: "receipt" },
      { claude },
    );
    expect(result).toMatchObject({ summaryRejected: false });
  });

  it("doesn't call Claude without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { create, claude } = fakeClaude(answer({}));
    expect(
      await readDocumentFacts(
        { bytes: PDF, contentType: "application/pdf", kind: "insurance_policy" },
        { claude },
      ),
    ).toEqual({ kind: "unavailable" });
    expect(create).not.toHaveBeenCalled();
  });

  it("reports a failed read, so the person fills in the facts", async () => {
    const file = { bytes: PDF, contentType: "application/pdf" as const, kind: "warranty" as const };
    const cases: [unknown, string][] = [
      [{ stop_reason: "refusal", content: [] }, "unfinished"],
      [{ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }, "not_json"],
      [{ stop_reason: "end_turn", content: [{ type: "text", text: "[1]" }] }, "not_json"],
    ];
    for (const [response, reason] of cases) {
      expect(await readDocumentFacts(file, fakeClaude(response))).toEqual({
        kind: "failed",
        reason,
      });
    }
    const create = vi.fn(async () => {
      throw new Anthropic.APIError(529, undefined, "overloaded", undefined);
    });
    expect(
      await readDocumentFacts(file, { claude: (() => ({ messages: { create } })) as never }),
    ).toEqual({ kind: "failed", reason: "api_529" });
  });
});
