import { describe, expect, it } from "vitest";
import { ATTENTION_ALWAYS, ATTENTION_STOP_AFTER } from "@/config/attention";
import { holds, hourWords, learnAttention, type AttentionMessage } from "./attention";

// Spec step 147, pure: Jane learns when the person answers, which channel gets answers and
// which kinds of message they never say yes to; it holds what isn't urgent for their hour
// (never more than a day) and never holds or stops urgent alerts, deadlines and bills.

const NOW = new Date("2026-10-19T15:00:00Z"); // 8am in Los Angeles
const DAY = 24 * 60 * 60 * 1000;
const TZ = "America/Los_Angeles";
const YES = [
  { id: "finding.yes", label: "Yes", kind: "primary" },
  { id: "finding.no", label: "No", kind: "secondary" },
];

let n = 0;
function msg(over: Partial<AttentionMessage> & { source?: string; daysAgo?: number }) {
  const { source = "budgets", daysAgo = 5, ...rest } = over;
  n += 1;
  return {
    dedupeKey: `${source}:${n}`,
    kind: "decision",
    actions: YES,
    status: "open",
    answeredWith: null,
    answeredAt: null,
    createdAt: new Date(NOW.getTime() - daysAgo * DAY),
    notifiedVia: null,
    ...rest,
  } satisfies AttentionMessage;
}
// Answered at 7pm Los Angeles time (02:00 UTC the next day).
const answeredAt7pm = (daysAgo: number) => new Date(Date.UTC(2026, 9, 20 - daysAgo, 2, 0));

describe("learnAttention", () => {
  it("stops a kind the person never says yes to, counting only messages old enough", () => {
    const unanswered = Array.from({ length: ATTENTION_STOP_AFTER }, (_, i) =>
      msg({ daysAgo: 3 + i }),
    );
    const { stopped } = learnAttention(unanswered, { timezone: TZ, now: NOW });
    expect(stopped).toEqual([
      expect.objectContaining({ source: "budgets", label: "budget check-ins", asked: 4 }),
    ]);
    // "No" isn't a yes either.
    const nos = unanswered.map((m) => ({ ...m, status: "answered", answeredWith: "No" }));
    expect(learnAttention(nos, { timezone: TZ, now: NOW }).stopped).toHaveLength(1);
    // One yes among them keeps the kind.
    const oneYes = [...unanswered.slice(1), msg({ status: "answered", answeredWith: "Yes" })];
    expect(learnAttention(oneYes, { timezone: TZ, now: NOW }).stopped).toEqual([]);
    // A message posted today hasn't had its chance yet.
    const fresh = [...unanswered.slice(1), msg({ daysAgo: 0 })];
    expect(learnAttention(fresh, { timezone: TZ, now: NOW }).stopped).toEqual([]);
  });

  it("counts afresh after Bring them back", () => {
    const unanswered = Array.from({ length: ATTENTION_STOP_AFTER }, (_, i) =>
      msg({ daysAgo: 3 + i }),
    );
    const resumed = { budgets: new Date(NOW.getTime() - 2 * DAY) };
    expect(learnAttention(unanswered, { timezone: TZ, now: NOW, resumed }).stopped).toEqual([]);
  });

  it("never stops urgent alerts, deadlines, bills or messages without a yes", () => {
    for (const source of ATTENTION_ALWAYS) {
      const rows = Array.from({ length: 6 }, (_, i) => msg({ source, daysAgo: 3 + i }));
      expect(learnAttention(rows, { timezone: TZ, now: NOW }).stopped, source).toEqual([]);
    }
    const noYes = Array.from({ length: 6 }, (_, i) =>
      msg({
        source: "did",
        daysAgo: 3 + i,
        actions: [{ id: "undo", label: "Undo", kind: "secondary" }],
      }),
    );
    expect(learnAttention(noYes, { timezone: TZ, now: NOW }).stopped).toEqual([]);
  });

  it("learns the hour the person usually answers, once there are enough answers", () => {
    const answers = [1, 2, 3, 4, 5].map((d) =>
      msg({ daysAgo: d, status: "answered", answeredWith: "Yes", answeredAt: answeredAt7pm(d) }),
    );
    expect(learnAttention(answers, { timezone: TZ, now: NOW }).usualHour).toBe(19);
    expect(learnAttention(answers.slice(1), { timezone: TZ, now: NOW }).usualHour).toBeNull();
    expect(hourWords(19)).toBe("around 7pm");
    expect(hourWords(0)).toBe("around 12am");
  });

  it("learns the channel that gets answers", () => {
    const pushed = [1, 2, 3, 4].map((d) => msg({ daysAgo: d, notifiedVia: "push" }));
    const emailed = [1, 2, 3, 4].map((d) =>
      msg({
        daysAgo: d,
        notifiedVia: "email",
        answeredAt: NOW,
        status: "answered",
        answeredWith: "Yes",
      }),
    );
    expect(learnAttention([...pushed, ...emailed], { timezone: TZ, now: NOW }).channel).toBe(
      "email",
    );
    expect(
      learnAttention([...pushed, ...emailed.slice(1)], { timezone: TZ, now: NOW }).channel,
    ).toBeNull();
  });
});

describe("holds", () => {
  const attention = {
    usualHour: 19,
    channel: null,
    stopped: [],
    lastPostedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
  };
  const at = { now: NOW, timezone: TZ, trigger: "sync" as const };

  it("holds what isn't urgent until the person's usual hour", () => {
    expect(holds(attention, "budgets", at)).toBe(true);
    // 6pm Los Angeles: within the window.
    expect(holds(attention, "budgets", { ...at, now: new Date("2026-10-20T01:00:00Z") })).toBe(
      false,
    );
  });

  it("never holds urgent things, when the person opened the chat, or after a day of quiet", () => {
    expect(holds(attention, "heads_ups", at)).toBe(false);
    expect(holds(attention, "billpay", at)).toBe(false);
    expect(holds(attention, "budgets", { ...at, trigger: "open" })).toBe(false);
    expect(
      holds({ ...attention, lastPostedAt: new Date(NOW.getTime() - DAY) }, "budgets", at),
    ).toBe(false);
    expect(holds({ ...attention, usualHour: null }, "budgets", at)).toBe(false);
    expect(holds(undefined, "budgets", at)).toBe(false);
  });
});
