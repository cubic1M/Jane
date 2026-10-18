import { describe, expect, it } from "vitest";
import { HULU, NETFLIX, SPOTIFY, input, monthly } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { duplicateSubscription } from "./duplicate-subscription";

const run = (data: DetectionInput) => duplicateSubscription(data, buildStreams(data));

describe("duplicate_subscription", () => {
  it("finds two services in one group and saves the cheaper one", () => {
    const transactions = [...monthly(6, 1549, NETFLIX), ...monthly(6, 1199, HULU)];

    const [finding] = run(input({ transactions }));

    expect(finding).toMatchObject({
      type: "duplicate_subscription",
      key: "group:video_streaming",
      title: "You pay for 2 video streaming services",
      annualSavingsCents: 1199 * 12,
      // Six charges each would be high, but duplicates are capped at medium.
      confidence: "medium",
    });
    expect((finding.evidence.services as unknown[]).length).toBe(2);
  });

  it("finds nothing when the services are in different groups", () => {
    const transactions = [...monthly(4, 1549, NETFLIX), ...monthly(4, 1199, SPOTIFY)];

    expect(run(input({ transactions }))).toEqual([]);
  });

  it("finds nothing for a single service", () => {
    expect(run(input({ transactions: monthly(4, 1549, NETFLIX) }))).toEqual([]);
  });
});
