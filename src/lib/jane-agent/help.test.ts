import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_GROUPS, HELP_MORE_LINKS } from "@/config/help";
import { checkGuardrails, dollarFigures } from "@/lib/guardrails";
import { gather, plan, type BrainSettings } from "./brain";
import { parseIntent } from "./intents";
import { TOUR_LINKS, groupedHelpReply } from "./replies-help";
import type { Snapshot } from "./snapshot";
import { welcomeTour } from "./actions/welcome";
import type { ChatMessage, MessageAction } from "./types";

// Spec step 140: help inside the chat. "help" comes in groups, each example something the
// rules understand; every link opens a real page; the first-run hello shows once, first.

const APP = join(process.cwd(), "src", "app");
// A link's page exists: /settings#autopilot is src/app/settings/page.tsx.
const resolves = (href: string) => {
  const path = href.split(/[?#]/)[0];
  return existsSync(join(APP, ...path.split("/").filter(Boolean), "page.tsx"));
};
const hrefs = (actions: readonly MessageAction[]) =>
  actions.flatMap((a) => (a.kind === "link" ? [a.href] : []));

describe("grouped help", () => {
  const reply = groupedHelpReply();

  it("lists every group with its examples, answer first", () => {
    expect(reply.body.split("\n")[0]).toBe(
      "Here's what I can help with. Ask in your own words, and I'll answer with buttons for you to tap; I never act on what you type alone.",
    );
    for (const group of HELP_GROUPS) {
      expect(reply.body).toContain(`${group.title}\n- ${group.examples[0]}`);
    }
  });

  it("only offers what the rules understand", () => {
    for (const example of HELP_GROUPS.flatMap((g) => g.examples)) {
      expect(parseIntent(example, "2026-10-19").kind, example).not.toBe("unknown");
    }
  });

  it("passes the standard guardrails, like any answer", () => {
    const shown = dollarFigures(reply.body).map((f) => f.cents);
    expect(checkGuardrails(reply.body, shown)).toEqual({ ok: true });
  });

  it("links every group and more, and every link resolves", () => {
    const links = hrefs(reply.actions);
    expect(links).toEqual([
      ...HELP_GROUPS.map((g) => g.link.href),
      ...HELP_MORE_LINKS.map((l) => l.href),
    ]);
    for (const href of [...links, ...hrefs(TOUR_LINKS), "/home"]) {
      expect(resolves(href), href).toBe(true);
    }
  });
});

describe("the first-run conversation", () => {
  const NOW = new Date("2026-10-19T13:00:00Z");
  const SYNC: BrainSettings = { trigger: "sync" };
  const snapshot = (firstChat: boolean | undefined) =>
    ({
      timezone: "America/New_York",
      asOf: "2026-10-19",
      weekStart: "2026-10-19",
      safeToSpend: null,
      comingUp: [],
      waitingOnYou: [],
      findings: [],
      plan: { items: 0, annualSavingsCents: 0, safeItems: 0 },
      ruleApprovals: [],
      finished: [],
      deadlines: [],
      budgetsOver: [],
      goalsBehind: [],
      urgentAlerts: [],
      budgetProgress: [],
      autopilot: null,
      setupProposals: [],
      agentSteps: [],
      assetPrompts: [],
      firstChat,
    }) as Snapshot;

  it("says hello first, outside the daily limit, only before Jane has said anything", () => {
    const first = plan(snapshot(true), { recent: [], seenKeys: [] }, NOW, {
      ...SYNC,
      dailyLimit: 0,
    });
    expect(first[0]).toMatchObject({
      source: "welcome",
      dedupeKey: "welcome:hello",
      kind: "brief",
    });
    expect(first[0].actions.map((a) => a.id)).toEqual(["welcome.tour", "open"]);
    for (const resolved of hrefs(first[0].actions)) expect(resolves(resolved)).toBe(true);
    // Once: never again, even if the person somehow had no messages again.
    const again = plan(snapshot(true), { recent: [], seenKeys: ["welcome:hello"] }, NOW, SYNC);
    expect(again.some((m) => m.source === "welcome")).toBe(false);
    for (const later of [false, undefined]) {
      expect(gather(snapshot(later), NOW, SYNC).some((m) => m.source === "welcome")).toBe(false);
    }
  });

  it("shows the tour in place on Show me around, keeping its links", async () => {
    const [hello] = gather(snapshot(true), NOW, SYNC).filter((m) => m.source === "welcome");
    const message = { ...hello, id: "m1", status: "open", refs: {} } as unknown as ChatMessage;
    const outcome = await welcomeTour.run({
      userId: "u1",
      message,
      action: hello.actions[0],
      client: {} as never,
      now: NOW,
    });
    expect(outcome.note).toMatch(/^Three things to know\./);
    expect(hrefs(outcome.actions ?? [])).toEqual(["/home", "/plan", "/settings#autopilot"]);
  });
});
