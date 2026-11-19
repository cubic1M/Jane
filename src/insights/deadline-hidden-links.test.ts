import { describe, expect, it } from "vitest";
import { isHiddenPage } from "@/config/hidden-pages";
import { upcomingDeadlines, type Deadline } from "./deadlines";

// Debug 3, 11-19 (class 9, debug3-invariants.md): the open-enrollment deadline linked to
// /insurance/benefits, a page the beta hides, on Home's strip and coming-up list and in the chat.

const enrollment: Deadline = {
  key: "work-enrollment:2026-11-13:end",
  title: "Last day of open enrollment at Acme Corp",
  date: "2026-11-13",
  kind: "renewal",
  source: "insurance",
  evidence: { kind: "entered" },
  amountCents: null,
  href: "/insurance/benefits",
  detail: null,
};

describe("the deadlines list's links", () => {
  it("never go to a page the beta hides", () => {
    const [shown] = upcomingDeadlines([enrollment], "2026-11-12");
    expect(shown?.href).toBe("/insurance");
    expect(isHiddenPage(shown!.href!)).toBe(false);
  });

  it("keep a link to a page that's shown", () => {
    const [shown] = upcomingDeadlines([{ ...enrollment, href: "/insurance" }], "2026-11-12");
    expect(shown?.href).toBe("/insurance");
  });
});
