import { beforeEach, describe, expect, it, vi } from "vitest";

const advice = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: async () => advice.on }));

import { demoTranscriptPartner, demoTranscriptText } from "./demo";
import { partnerTranscripts, transcriptPartnerFor } from "./index";

// Connectors roadmap round 16, Stage 4: a Chart-shaped transcript partner, demo bank only.

const NOW = new Date("2026-11-06T12:00:00Z");

beforeEach(() => {
  advice.on = false;
});

describe("which transcript partner a person gets", () => {
  it("is none for a real account, and the stand-in for the demo bank", async () => {
    expect(await transcriptPartnerFor("user_real", { now: NOW })).toBeNull();
    expect(await partnerTranscripts("user_real", { now: NOW })).toBeNull();
    advice.on = true;
    expect((await transcriptPartnerFor("user_demo", { now: NOW }))?.name).toBe("demo");
  });
});

describe("the demo partner", () => {
  it("reads the last two tax years, a return, withholding and the refund that's the difference", async () => {
    advice.on = true;
    const transcripts = (await partnerTranscripts("user_demo", { now: NOW }))!;
    expect(transcripts.map((t) => t.taxYear)).toEqual([2025, 2024]);
    for (const t of transcripts) {
      expect(t.lines.map((l) => l.code)).toEqual(["150", "806", "846"]);
      const [filed, withheld, refund] = t.lines;
      expect(refund!.cents).toBe(-withheld!.cents - filed!.cents);
      expect(refund!.cents).toBeGreaterThan(0);
    }
  });

  it("is the same every time for the same person, and different for another", () => {
    expect(demoTranscriptText(2025, "a")).toBe(demoTranscriptText(2025, "a"));
    expect(demoTranscriptText(2025, "a")).not.toBe(demoTranscriptText(2025, "b"));
  });

  it("won't hand over a transcript under another person's consent", async () => {
    const partner = demoTranscriptPartner(2026);
    const mine = await partner.startConsent("user_a");
    const theirs = await partner.startConsent("user_b");
    const [listed] = await partner.listTranscripts(mine.consentId);
    await expect(partner.fetchTranscript(theirs.consentId, listed!.id)).rejects.toThrow(
      "No such transcript",
    );
    expect(await partner.fetchTranscript(mine.consentId, listed!.id)).toContain(
      "Account Transcript",
    );
  });

  it("sends the person nowhere outside Jane", async () => {
    const { url } = await demoTranscriptPartner(2026).startConsent("user_a");
    expect(url.startsWith("/")).toBe(true);
  });
});
