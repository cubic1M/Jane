import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { create, captureImmediate, PostHogMock } = vi.hoisted(() => {
  const captureImmediate = vi.fn();
  return {
    create: vi.fn(),
    captureImmediate,
    PostHogMock: vi.fn(function () {
      return { captureImmediate };
    }),
  };
});

vi.mock("@/lib/db", () => ({ db: { analyticsEvent: { create } } }));
vi.mock("posthog-node", () => ({ PostHog: PostHogMock }));

import { resetAnalyticsForTests, track } from "./analytics";

describe("track", () => {
  beforeEach(() => {
    resetAnalyticsForTests();
    create.mockReset().mockResolvedValue({});
    captureImmediate.mockReset().mockResolvedValue(undefined);
    PostHogMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes the event to analytics_events", async () => {
    await track("user_1", "signup_completed", { method: "email" });

    expect(create).toHaveBeenCalledWith({
      data: { userId: "user_1", name: "signup_completed", properties: { method: "email" } },
    });
  });

  // Spec step 138.
  it("never counts someone trying Jane with sample data", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    await track("trial_abc123", "card_opened", { finding_id: "f1" });
    expect(create).not.toHaveBeenCalled();
    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it("keeps what an event's name would reveal out of PostHog, but stores it", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    resetAnalyticsForTests();
    for (const name of [
      "medical_request_sent",
      "tax_identity_case_opened",
      "tight_request_sent",
      "lean_plan_started",
      "insurance_claim_started",
      "tax_notice_confirmed",
      "cosigned_loan_added",
      "debt_planner_viewed",
      "an_event_added_next_year",
    ]) {
      await track("user_1", name, {});
      expect(create).toHaveBeenLastCalledWith({ data: { userId: "user_1", name, properties: {} } });
    }
    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it("keeps a bank's name out of PostHog, and in our own table", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    resetAnalyticsForTests();
    await track("user_1", "link_succeeded", { institution: "A Bank", demo: true });
    expect(create).toHaveBeenLastCalledWith({
      data: {
        userId: "user_1",
        name: "link_succeeded",
        properties: { institution: "A Bank", demo: true },
      },
    });
    expect(captureImmediate.mock.calls[0][0].properties).toEqual({ demo: true });
    captureImmediate.mockClear();
    await track("user_1", "signed_in", { method: "email", carrier: "An Insurer", cents: 5 });
    expect(captureImmediate.mock.calls[0][0].properties).toEqual({ method: "email", cents: 5 });
  });

  it("skips PostHog when no key is configured", async () => {
    vi.stubEnv("POSTHOG_KEY", "");

    await track(null, "landing_viewed");

    expect(create).toHaveBeenCalledOnce();
    expect(PostHogMock).not.toHaveBeenCalled();
  });

  it("sends to PostHog using the user id when signed in", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");

    await track("user_1", "signup_completed");

    expect(captureImmediate).toHaveBeenCalledWith({
      distinctId: "user_1",
      event: "signup_completed",
      properties: {},
    });
  });

  it("falls back to the anonymous id for visitors", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");

    await track(null, "landing_viewed", { anonymous_id: "anon-123" });

    expect(captureImmediate).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: "anon-123" }),
    );
  });

  it("does not throw when PostHog fails", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    captureImmediate.mockRejectedValue(new Error("PostHog down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(track(null, "landing_viewed")).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalled();
  });

  it("throws when the database write fails, so lost events are visible", async () => {
    create.mockRejectedValue(new Error("db down"));

    await expect(track(null, "landing_viewed")).rejects.toThrow("db down");
  });
});
