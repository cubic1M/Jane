import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { parseIntent } from "@/lib/jane-agent/intents";
import {
  noteLines,
  readingBody,
  readingHints,
  readingLines,
} from "@/lib/jane-agent/insurance/reading-words";
import { readPolicyDetails } from "./read-policy";
import { checkReading, flatten, mergeLayers, toInput } from "./reading-rules";
import { sameInsurer, type Reading } from "./readings";

// Policies read from documents (spec step 151): the rules that check what was read, where
// each field came from, Claude's reading of the cover limits, and the words. Pure.

const AS_OF = "2026-10-19";

describe("where each field comes from", () => {
  it("takes each field from the best place that has it", () => {
    const merged = mergeLayers([
      { source: "document", fields: { deductible: "500", "coverage.collision": "yes" } },
      { source: "document", fields: { carrier: "GEICO", premium: "612", kind: "auto" } },
      {
        source: "payments",
        fields: { carrier: "GEICO", premium: "102", premiumFrequency: "monthly" },
      },
      { source: "policy", fields: { termMonths: "6", deductible: "1000" } },
    ]);
    expect(merged.fields).toEqual({
      deductible: "500",
      "coverage.collision": "yes",
      carrier: "GEICO",
      premium: "612",
      kind: "auto",
      premiumFrequency: "monthly",
      termMonths: "6",
    });
    expect(merged.sources).toEqual({
      deductible: "document",
      "coverage.collision": "document",
      carrier: "document",
      premium: "document",
      kind: "document",
      premiumFrequency: "payments",
      termMonths: "policy",
    });
  });

  it("goes to the form's fields and back", () => {
    const input = toInput({
      kind: "auto",
      carrier: "GEICO",
      "coverage.bodilyInjuryPerPerson": "100000",
    });
    expect(input).toMatchObject({
      kind: "auto",
      carrier: "GEICO",
      termMonths: "12",
      coverage: { bodilyInjuryPerPerson: "100000" },
    });
    expect(flatten(input)).toEqual({
      kind: "auto",
      carrier: "GEICO",
      termMonths: "12",
      "coverage.bodilyInjuryPerPerson": "100000",
    });
  });

  it("knows the same insurer by its first word", () => {
    expect(sameInsurer("GEICO", "Geico General Insurance Co.")).toBe(true);
    expect(sameInsurer("State Farm", "Farmers")).toBe(false);
    expect(sameInsurer("", "GEICO")).toBe(false);
  });
});

describe("the rules that check what was read", () => {
  const check = (fields: Record<string, string>, paidYearlyCents: number | null = null) =>
    checkReading(
      {
        fields,
        sources: Object.fromEntries(Object.keys(fields).map((k) => [k, "document" as const])),
      },
      { asOf: AS_OF, paidYearlyCents },
    );

  it("keeps what parses, as the form writes it", () => {
    const { fields, notes } = check({
      kind: "auto",
      carrier: "  GEICO   General ",
      premium: "$612",
      premiumFrequency: "semiannual",
      deductible: "500",
      renewalDate: "2027-03-01",
      "coverage.bodilyInjuryPerPerson": "100000",
      "coverage.collision": "yes",
    });
    expect(fields).toMatchObject({
      carrier: "GEICO General",
      premium: "612.00",
      deductible: "500.00",
      renewalDate: "2027-03-01",
    });
    expect(notes).toEqual({});
  });

  it("leaves out what fails, saying why", () => {
    const { fields, sources, notes } = check({
      kind: "auto",
      carrier: "GEICO",
      premium: "about six hundred",
      deductible: "5000",
      renewalDate: "2031-01-01",
      "coverage.bodilyInjuryPerPerson": "2000",
      "coverage.collision": "maybe",
      "coverage.deathBenefit": "500000",
    });
    expect(Object.keys(fields).sort()).toEqual([
      "carrier",
      "coverage.bodilyInjuryPerPerson",
      "kind",
    ]);
    expect(sources).toEqual({
      kind: "document",
      carrier: "document",
      "coverage.bodilyInjuryPerPerson": "document",
    });
    expect(notes).toEqual({
      premium: "I couldn't read the price.",
      deductible: "It was higher than the cover limits, so I left it out.",
      renewalDate: "That date doesn't fit a policy term, so I left it out.",
      "coverage.collision": 'Pick yes or no for "Collision (damage to your car in a crash)".',
    });
  });

  it("points out a price that's far from what the payments show, keeping it", () => {
    const far = check(
      { kind: "auto", carrier: "GEICO", premium: "612", premiumFrequency: "semiannual" },
      300_000,
    );
    expect(far.fields.premium).toBe("612.00");
    expect(far.notes.premium).toBe("Your payments come to $3,000.00 a year, so check this.");
    const near = check(
      { kind: "auto", carrier: "GEICO", premium: "612", premiumFrequency: "semiannual" },
      122_400,
    );
    expect(near.notes).toEqual({});
    expect(check({ kind: "auto", carrier: "GEICO", premium: "612" }).notes).toEqual({
      premiumFrequency: "Pick how often you pay.",
    });
  });

  it("asks for the kind when it isn't known", () => {
    const { fields, sources, notes } = check({ carrier: "GEICO", kind: "spaceship" });
    expect(fields.kind).toBe("other");
    expect(sources.kind).toBeUndefined();
    expect(notes.kind).toBe("Pick what kind of insurance it is.");
  });
});

describe("Claude reading the cover limits", () => {
  const PDF = Buffer.from("%PDF-1.7\n");
  const fake = (response: unknown) => {
    const create = vi.fn(async () => response);
    return { create, claude: (() => ({ messages: { create } })) as never };
  };
  beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-key"));
  afterEach(() => vi.unstubAllEnvs());

  it("asks for this kind's limits and reads them back", async () => {
    const { create, claude } = fake({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            deductible: "500",
            bodilyInjuryPerPerson: "100000",
            bodilyInjuryPerAccident: "",
            propertyDamage: "",
            collision: "yes",
            comprehensive: "",
            uninsuredMotorist: "",
          }),
        },
      ],
    });
    const result = await readPolicyDetails({ bytes: PDF, contentType: "application/pdf" }, "auto", {
      claude,
    });
    expect(result).toEqual({
      kind: "claude",
      fields: {
        deductible: "500",
        "coverage.bodilyInjuryPerPerson": "100000",
        "coverage.collision": "yes",
      },
    });
    const call = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0] as {
      output_config: { format: { schema: { required: string[] } } };
    };
    expect(call.output_config.format.schema.required).toEqual([
      "deductible",
      "bodilyInjuryPerPerson",
      "bodilyInjuryPerAccident",
      "propertyDamage",
      "collision",
      "comprehensive",
      "uninsuredMotorist",
    ]);
  });

  it("reads nothing without a key, and says why when Claude fails", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await readPolicyDetails({ bytes: PDF, contentType: "application/pdf" }, "auto")).toEqual(
      { kind: "unavailable" },
    );
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const create = vi.fn(async () => {
      throw new Anthropic.APIError(529, undefined, "overloaded", new Headers());
    });
    expect(
      await readPolicyDetails({ bytes: PDF, contentType: "application/pdf" }, "auto", {
        claude: (() => ({ messages: { create } })) as never,
      }),
    ).toEqual({ kind: "failed", reason: "api_529" });
  });
});

describe("in the chat", () => {
  const reading: Reading = {
    id: "r1",
    documentId: "d1",
    title: "GEICO car insurance",
    policyId: null,
    input: toInput({
      kind: "auto",
      carrier: "GEICO",
      premium: "612.00",
      premiumFrequency: "semiannual",
      deductible: "500.00",
      renewalDate: "2027-03-01",
      "coverage.bodilyInjuryPerPerson": "100000",
    }),
    sources: {
      kind: "document",
      carrier: "document",
      premium: "payments",
      premiumFrequency: "payments",
      deductible: "document",
      renewalDate: "you",
      "coverage.bodilyInjuryPerPerson": "document",
    },
    notes: {
      "coverage.collision": 'Pick yes or no for "Collision (damage to your car in a crash)".',
    },
    status: "waiting",
    createdAt: new Date("2026-10-19T12:00:00Z"),
  };

  it("says each field with where it came from, and that nothing's saved yet", () => {
    expect(readingBody(reading).split("\n")).toEqual([
      "I read your GEICO car policy. Is this right?",
      "- Insurer: GEICO (from the document)",
      "- Price: $612.00 every 6 months (from your payments)",
      "- Deductible: $500.00 (from the document)",
      "- Injury liability, per person: $100,000.00 (from the document)",
      "- Renews on: Mar 1, 2027 (as you typed it)",
      "Worth a look:",
      '- Collision (damage to your car in a crash): Pick yes or no for "Collision (damage to your car in a crash)".',
      "Nothing is added to your insurance until you confirm.",
    ]);
    expect(readingBody({ ...reading, policyId: "p1" }).split("\n")[0]).toBe(
      "I read the renewal notice for your GEICO car policy. Is this right?",
    );
    expect(readingLines({ ...reading, sources: {} })[0]).toBe("Insurer: GEICO");
    expect(
      noteLines({ ...reading, notes: { kind: "Pick what kind of insurance it is." } }),
    ).toEqual([]);
  });

  it("shows where each field came from on the page", () => {
    expect(readingHints(reading)).toMatchObject({
      carrier: "From the document.",
      premium: "From your payments.",
      "coverage.collision": 'Pick yes or no for "Collision (damage to your car in a crash)".',
    });
    expect(
      readingHints({ sources: { premium: "document" }, notes: { premium: "Check this." } }),
    ).toEqual({ premium: "From the document. Check this." });
  });

  it("reads questions about policy documents", () => {
    for (const text of [
      "did you read my policy",
      "I uploaded my renewal notice",
      "what did you get from my declarations page",
    ]) {
      expect(parseIntent(text, AS_OF), text).toMatchObject({ kind: "insurance", ask: "documents" });
    }
    expect(parseIntent("when does my policy renew", AS_OF)).toMatchObject({ ask: "renew" });
  });
});
