import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_FOR_FINDING } from "./cards";
import { DRAFTABLE, PLACEHOLDERS, draftMessage, draftPayload, templateDraft } from "./drafts";
import { SECRET_STRINGS, findingOfType, sampleFindings } from "./__fixtures__/findings";
import { checkGuardrails } from "./guardrails";

// One sample finding per action type that can be drafted.
const cases = sampleFindings()
  .filter((f) => DRAFTABLE[ACTION_FOR_FINDING[f.type]])
  .map((f) => [ACTION_FOR_FINDING[f.type], f] as const);

describe("draftPayload", () => {
  it("covers every draftable action type with a sample", () => {
    expect(new Set(cases.map(([type]) => type))).toEqual(new Set(Object.keys(DRAFTABLE)));
  });

  it.each(cases)("%s: holds only what the merchant needs", (actionType, finding) => {
    const prepared = draftPayload(actionType, finding);
    const text = JSON.stringify(prepared?.payload);

    for (const secret of SECRET_STRINGS) expect(text).not.toContain(secret);
    // No descriptions, account ids, or our savings estimate.
    for (const t of (finding.evidence.charges ?? finding.evidence.transactions ?? []) as {
      description: string;
    }[]) {
      expect(text).not.toContain(t.description);
    }
    expect(text).not.toMatch(/savingsPerYear|yearlyCost|annualCost|typicalPrice|accountId/);
    for (const key of Object.keys(prepared?.payload.facts ?? {})) {
      expect(DRAFTABLE[actionType]?.facts).toContain(key);
    }
  });

  it("has nothing to draft for actions without one company to contact", () => {
    expect(draftPayload("move_idle_cash", findingOfType("idle_cash"))).toBeNull();
    expect(draftPayload("insurance_reshop", findingOfType("insurance_reshop"))).toBeNull();
  });
});

describe("templateDraft", () => {
  it.each(cases)("%s: passes the guardrails and uses the placeholders", (actionType, finding) => {
    const prepared = draftPayload(actionType, finding)!;
    const draft = templateDraft(prepared.payload);

    expect(checkGuardrails(`${draft.subject}\n${draft.body}`, prepared.allowedCents)).toEqual({
      ok: true,
    });
    expect(draft.body).toContain(PLACEHOLDERS.name);
    expect(draft.channel).toBe(DRAFTABLE[actionType]?.channel);
  });
});

describe("draftMessage", () => {
  const create = vi.fn();
  const client = () => ({ messages: { create } }) as never;
  const reply = (json: object) => ({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(json) }],
  });
  const refund = findingOfType("duplicate_charge");

  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    create.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends Claude the payload and nothing else", async () => {
    create.mockResolvedValue(
      reply({ subject: "Refund request", body: `Please refund $49.99. ${PLACEHOLDERS.name}` }),
    );

    const result = await draftMessage("request_refund", refund, { client });

    expect(result).toMatchObject({ kind: "llm", draft: { channel: "email" } });
    const sent = create.mock.calls[0][0];
    expect(sent.messages).toEqual([
      { role: "user", content: JSON.stringify(draftPayload("request_refund", refund)?.payload) },
    ]);
  });

  it("falls back to the template when Claude adds a figure or a promise", async () => {
    for (const body of ["Please refund $500.00.", "You will get your money back, guaranteed."]) {
      create.mockResolvedValue(reply({ subject: "Refund", body }));
      expect(await draftMessage("request_refund", refund, { client })).toMatchObject({
        kind: "template",
        reason: "guardrails",
      });
    }
  });

  it("uses the template without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await draftMessage("request_refund", refund, { client })).toMatchObject({
      kind: "template",
      reason: "no_api_key",
    });
    expect(create).not.toHaveBeenCalled();
  });
});
