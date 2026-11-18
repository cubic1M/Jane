import { describe, expect, it } from "vitest";
import type { CloseView } from "@/lib/month-close";
import { waitingBody } from "./replies-close";

// Debug 2, fifth desktop sweep (11-17, Plaid sandbox default user): "Is last month closed?" got
// "Closing October 2026: I wasn't sure what this charge was. Are they right as they are?" for
// one charge. The question is the same; one charge is "it".

const view = (n: number) =>
  ({
    month: "2026-10",
    status: "waiting",
    figures: {},
    uncertain: Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      date: "2026-10-18",
      description: "OPENAI",
      name: "OpenAI",
      amountCents: 2_000,
    })),
    closedAt: null,
    correctedAt: null,
  }) as unknown as CloseView;

describe("the close's question", () => {
  it("asks about one charge as it", () => {
    expect(waitingBody(view(1)).split("\n")[0]).toBe(
      "Closing October 2026: I wasn't sure what this charge was. Is it right as it is?",
    );
  });

  it("asks about several as they", () => {
    expect(waitingBody(view(2)).split("\n")[0]).toBe(
      "Closing October 2026: I wasn't sure what these 2 charges were. Are they right as they are?",
    );
  });
});
