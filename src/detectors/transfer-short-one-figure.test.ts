import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { formatCents } from "@/lib/money";
import { runDetectors } from "./index";

// Debugger 11-15: on Loans, "Card interest you can cut, $554/yr: Your cards cost you about
// $554.17 a year in interest." sat right above "Move card debt to 0%, $313/yr: You owe $2,410.50
// on cards and paid $385.75 in interest." Two interest figures for the same cards, one line
// apart: a year at today's balances and rates against what was charged last year. The
// transfer's line says its own saving; what was charged stays in its why, with its months.

const fire = (id: string) => {
  const data = inputFor(id);
  return runDetectors({ profile: buildProfile(data), data });
};
const figures = (text: string) => text.match(/\$[\d,]+\.\d\d/g) ?? [];

describe("a 0% transfer's line beside the card interest", () => {
  it("names the debt and the saving, not a second interest figure", () => {
    const all = fire("renter");
    const transfer = all.find((s) => s.topic === "balance_transfer")!;
    expect(transfer).toBeDefined();
    const debt = transfer.why.match(/You owe (\$[\d,]+\.\d\d)/)![1]!;
    expect(figures(transfer.short).sort()).toEqual([debt, formatCents(transfer.worthCents)].sort());
  });

  it("keeps what the cards charged, with its months, behind More", () => {
    const transfer = fire("renter").find((s) => s.topic === "balance_transfer")!;
    expect(transfer.why).toMatch(/paid \$[\d,]+\.\d\d in interest over \d+ months/);
  });
});
