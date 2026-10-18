import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scoped } = vi.hoisted(() => ({
  scoped: { userId: "user_1", findings: { findMany: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => scoped) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { findingOfType } from "./__fixtures__/findings";
import { EXPLAIN_PROMPT_VERSION, type ExplanationResult } from "./explain";
import { inputHash, prepareExplainInput } from "./explain-input";
import { explainFindings } from "./explanations";

const CONTENT = {
  title: "Netflix went up",
  explanation: "Netflix now charges $17.99 a month.",
  giveUp: "Nothing.",
  alternatives: [],
};

function row(type: Parameters<typeof findingOfType>[0], overrides: Record<string, unknown> = {}) {
  const f = findingOfType(type);
  return {
    id: `finding_${type}`,
    type: f.type,
    title: f.title,
    annualSavingsCents: f.annualSavingsCents,
    evidence: f.evidence,
    explanation: null as unknown,
    explanationHash: null as string | null,
    ...overrides,
  };
}

const hashOf = (finding: ReturnType<typeof row>) =>
  inputHash(prepareExplainInput(finding).input, EXPLAIN_PROMPT_VERSION);

describe("explainFindings", () => {
  beforeEach(() => {
    scoped.findings.findMany.mockReset();
    scoped.findings.update.mockReset();
    vi.mocked(logAudit).mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-test-model");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes nothing without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const explain = vi.fn();

    expect(await explainFindings("user_1", { explain })).toEqual({
      llm: 0,
      template: 0,
      unavailable: 0,
    });
    expect(scoped.findings.findMany).not.toHaveBeenCalled();
    expect(explain).not.toHaveBeenCalled();
  });

  it("explains only findings whose input changed and stores the audit trail", async () => {
    const fresh = row("bank_fees");
    fresh.explanationHash = hashOf(fresh);
    const stale = row("price_increase", { explanationHash: "old" });
    scoped.findings.findMany.mockResolvedValue([fresh, stale]);
    const explain = vi.fn(async (): Promise<ExplanationResult> => ({
      kind: "llm",
      content: CONTENT,
      model: "claude-test-model",
      hash: "new-hash",
    }));

    const summary = await explainFindings("user_1", { explain });

    expect(explain).toHaveBeenCalledTimes(1);
    expect(explain).toHaveBeenCalledWith(stale);
    expect(scoped.findings.update).toHaveBeenCalledWith({
      where: { id: "finding_price_increase" },
      data: {
        explanation: CONTENT,
        explanationSource: "llm",
        explanationModel: "claude-test-model",
        explanationPrompt: EXPLAIN_PROMPT_VERSION,
        explanationHash: "new-hash",
      },
    });
    expect(summary).toEqual({ llm: 1, template: 0, unavailable: 0 });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "system", id: null },
      "explanations_generated",
      { type: "user", id: "user_1" },
      { llm: 1, template: 0, model: "claude-test-model", prompt_version: EXPLAIN_PROMPT_VERSION },
    );
  });

  it("stores a guardrail fallback so the same input isn't sent again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    scoped.findings.findMany.mockResolvedValue([row("price_increase")]);
    const explain = vi.fn(async (): Promise<ExplanationResult> => ({
      kind: "template",
      reason: "guardrails",
      issues: ["unsupported_dollar_figure"],
      content: CONTENT,
      hash: "h",
    }));

    await explainFindings("user_1", { explain });

    expect(scoped.findings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ explanationSource: "template", explanationModel: null }),
      }),
    );
  });

  it("leaves a finding alone when the API is down, so the next run retries", async () => {
    scoped.findings.findMany.mockResolvedValue([row("price_increase")]);
    const explain = vi.fn(async (): Promise<ExplanationResult> => ({
      kind: "unavailable",
      content: CONTENT,
      hash: "h",
    }));

    expect(await explainFindings("user_1", { explain })).toMatchObject({ unavailable: 1 });
    expect(scoped.findings.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
