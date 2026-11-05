import { describe, expect, it } from "vitest";
import type { AccountantPageView } from "@/lib/accountant";
import { HIDDEN_PAGES } from "@/config/hidden-pages";
import { accountantReply, complexMessage } from "./accountant-message";

// The accountant's page is hidden in the closed beta, and its link lands on /taxes with nothing to
// make. The chat still said "I can give them a read-only link" with a button to it.
const view = {
  year: 2026,
  complexity: {
    text: "You have stock awards this year, which people usually bring an accountant.",
  },
  activeCount: 0,
  questions: [],
  unseen: 0,
  notes: [],
} as unknown as AccountantPageView;

const links = (m: ReturnType<typeof complexMessage>) =>
  (m?.actions ?? []).flatMap((a) => (a.kind === "link" ? [a.href] : []));
const hidden = (href: string) => HIDDEN_PAGES.some((p) => p.path === href);

describe("working with an accountant while the page is hidden", () => {
  it("offers what's there, the tax-time pack, and no link it can't make", () => {
    for (const message of [complexMessage(view), accountantReply(view)]) {
      expect(links(message)).toEqual(["/tax-pack"]);
      expect(links(message).some(hidden)).toBe(false);
      expect(message?.body).not.toMatch(/read-only link|made a link|A link shows/);
      expect(message?.body).toMatch(/tax-time pack/);
    }
  });
});
