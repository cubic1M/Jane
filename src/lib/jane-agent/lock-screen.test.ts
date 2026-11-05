import { describe, expect, it } from "vitest";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { bundledPushMessage, chatPushMessage, emailBody } from "./notify";

// An independent read of what Jane sends outside the app: a chat push put up to 180 characters of
// the message on the lock screen. A clinic's name, a debt and a private goal's name, seen by
// anyone near the phone. An alert's was already fixed; these went out as written.
describe("what a chat notification shows on a lock screen", () => {
  const message = (body: string, kind = "heads_up") => ({
    id: "m1",
    dedupeKey: "heads_ups:x",
    priority: 1,
    createdAt: new Date("2026-11-04T12:00:00Z"),
    notifiedAt: null,
    notifiedVia: null,
    kind,
    body,
    refs: {},
    actions: [
      { id: "finding.pick", label: "Switch to Ally", kind: "primary" },
      { id: "autopilot.yes", label: "Invest $200", kind: "primary" },
    ],
  });
  const PRIVATE = 'Mercy Clinic charged $1,240.00 on Oct 3. Your goal "Divorce fund" is behind.';

  const shown = (p: { title: string; body: string; actions?: { title: string }[] }) =>
    [p.title, p.body, ...(p.actions ?? []).map((a) => a.title)].join(" ");

  it.each(["decision", "heads_up", "done", "brief"])("keeps %s text inside the app", (kind) => {
    const text = shown(chatPushMessage(message(PRIVATE, kind)));
    expect(text).not.toMatch(/\$|\d|Clinic|Divorce|Ally/);
  });

  it("labels demo advice in an email, and nothing else", () => {
    expect(emailBody({ body: "Sell before Dec 31.", refs: { advice: true } })).toBe(
      `${DEMO_ADVICE_LABEL}\nSell before Dec 31.`,
    );
    expect(emailBody({ body: "Rent is tomorrow.", refs: {} })).toBe("Rent is tomorrow.");
  });

  it("keeps a bundle's first message inside the app too", () => {
    const text = bundledPushMessage([message(PRIVATE), message("Second")]).body;
    expect(text).toBe("Jane has 2 things for you.");
  });
});
