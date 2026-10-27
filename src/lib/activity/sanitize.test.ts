import { describe, expect, it } from "vitest";
import { ACTIVITY } from "@/config/activity";
import { anonymousOnly, sanitizeBatch } from "./sanitize";

const NOW = new Date("2026-10-26T18:00:00Z");
const at = NOW.getTime() - 2_000;
const batch = (events: unknown[]) => sanitizeBatch({ visitId: "visit12345", events }, NOW);

describe("sanitizeBatch: the server's check on what the browser sent", () => {
  it("rejects something that isn't a batch", () => {
    expect(sanitizeBatch(null, NOW)).toBeNull();
    expect(sanitizeBatch({ events: [] }, NOW)).toBeNull();
    expect(sanitizeBatch({ visitId: "../../x", events: [] }, NOW)).toBeNull();
    expect(sanitizeBatch({ visitId: "visit12345", events: "no" }, NOW)).toBeNull();
  });

  it("keeps a click's role and label, redacted again", () => {
    expect(
      batch([
        {
          kind: "click",
          path: "/subscriptions?x=1",
          at,
          role: "button",
          label: "Cancel Netflix $15.99",
        },
      ])?.events,
    ).toEqual([
      {
        visitId: "visit12345",
        kind: "click",
        path: "/subscriptions",
        role: "button",
        label: "Cancel Netflix #",
        data: {},
        createdAt: new Date(at),
      },
    ]);
  });

  it("never keeps a typed value, whatever key the browser puts it under", () => {
    const [blur] = batch([
      {
        kind: "blur",
        path: "/goals",
        at,
        label: "goal",
        value: "my secret",
        data: { typed: true, length: 9, value: "my secret", text: "my secret", fields: ["x"] },
      },
    ])!.events;
    expect(blur.data).toEqual({ typed: true, private: false, length: 9 });
    expect(JSON.stringify(blur)).not.toContain("secret");
  });

  it("drops the length of a private field", () => {
    const [blur] = batch([
      {
        kind: "blur",
        path: "/goals",
        at,
        label: "amount",
        data: { typed: true, private: true, length: 6 },
      },
    ])!.events;
    expect(blur.data).toEqual({ typed: true, private: true });
  });

  it("keeps a submit's field names and timing, never their values", () => {
    const [submit] = batch([
      {
        kind: "submit",
        path: "/goals",
        at,
        label: "goal-form",
        data: { ms: 12_345.6, fields: ["name", "target", 42, "me@example.com"], values: ["Trip"] },
      },
    ])!.events;
    expect(submit).toMatchObject({
      label: "goal-form",
      data: { ms: 12_346, fields: ["name", "target", "[email]"] },
    });
    expect(JSON.stringify(submit)).not.toContain("Trip");
  });

  it("keeps an error message short and without emails or numbers", () => {
    const [error] = batch([
      {
        kind: "error",
        path: "/home",
        at,
        label: `Failed for jo@example.com card 4111 ${"x".repeat(500)}`,
      },
    ])!.events;
    expect(error.label).toMatch(/^Failed for \[email\] card # x+…$/);
    expect(error.label!.length).toBeLessThanOrEqual(ACTIVITY.maxError);
  });

  it("drops unknown kinds, bad paths and bad roles", () => {
    const rows = batch([
      { kind: "keystroke", path: "/home", at, label: "a" },
      { kind: "click", path: "https://evil.example/", at },
      { kind: "click", path: "/home", at, role: "<script>" },
    ])!.events;
    expect(rows).toEqual([expect.objectContaining({ kind: "click", path: "/home", role: null })]);
  });

  it("uses the server's time for a clock far off", () => {
    const [view] = batch([{ kind: "page_view", path: "/home", at: 0 }])!.events;
    expect(view.createdAt).toEqual(NOW);
  });

  it("reads at most one batch's worth", () => {
    const many = Array.from({ length: 500 }, () => ({ kind: "page_view", path: "/home", at }));
    expect(batch(many)!.events).toHaveLength(ACTIVITY.maxBatch);
  });
});

describe("anonymousOnly: before sign-in", () => {
  it("keeps only views of the landing page", () => {
    const rows = batch([
      { kind: "page_view", path: "/", at },
      { kind: "page_view", path: "/login", at },
      { kind: "click", path: "/", at, label: "Get started" },
      { kind: "blur", path: "/", at, label: "email", data: { typed: true } },
    ])!.events;
    expect(anonymousOnly(rows).map((r) => [r.kind, r.path])).toEqual([["page_view", "/"]]);
  });
});
