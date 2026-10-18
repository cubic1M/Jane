import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recommendsAChoice } from "@/lib/guardrails";
import { LIFE_EVENTS, LIFE_EVENT_KINDS, isLifeEventKind } from "./life-events";

describe("life-event checklists", () => {
  it.each(LIFE_EVENT_KINDS)("%s has 6 to 10 short items with unique keys", (kind) => {
    const { items } = LIFE_EVENTS[kind];
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.length).toBeLessThanOrEqual(10);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    for (const item of items) expect(item.label.length).toBeLessThanOrEqual(80);
  });

  it.each(LIFE_EVENT_KINDS)("%s links only to Jane pages that exist", (kind) => {
    for (const item of LIFE_EVENTS[kind].items.filter((i) => i.href)) {
      expect(item.linkLabel).toBeTruthy();
      expect(existsSync(join(process.cwd(), "src/app", item.href!, "page.tsx")), item.href).toBe(
        true,
      );
    }
  });

  it("never tells the person what to choose", () => {
    for (const kind of LIFE_EVENT_KINDS) {
      const { title, intro, items } = LIFE_EVENTS[kind];
      for (const text of [title, intro, ...items.map((i) => i.label)]) {
        expect(recommendsAChoice(text), text).toBe(false);
        expect(text).not.toMatch(/you should|deductible|deductions?|write[- ]?off|tax/i);
      }
    }
  });

  it("knows its kinds", () => {
    expect(isLifeEventKind("new_baby")).toBe(true);
    expect(isLifeEventKind("divorce")).toBe(false);
    expect(isLifeEventKind(undefined)).toBe(false);
  });
});
