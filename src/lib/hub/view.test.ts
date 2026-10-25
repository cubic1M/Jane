import { describe, expect, it } from "vitest";
import {
  cashFlowView,
  cashGroups,
  chartText,
  heroView,
  shortMoney,
  tilesView,
  type AreasInput,
  type HeroInput,
} from "./view";

// The home hub's view model (docs/design/home-hub.md): it only picks, orders, labels and
// scales what the pages already worked out.

const ASOF = "2026-10-23";

const hero = (over: Partial<HeroInput> = {}): HeroInput => ({
  asOf: ASOF,
  safe: {
    payday: "2026-10-31",
    balanceCents: 300_000,
    billsCents: 120_000,
    budgetsLeftCents: 40_000,
    goalsCents: 20_000,
    setAsideCents: 0,
    safeCents: 120_000,
  },
  netWorth: {
    todayCents: 4_820_000,
    months: [
      { month: "2025-11", netCents: 4_000_000 },
      { month: "2025-12", netCents: null },
      { month: "2026-10", netCents: 4_820_000 },
    ],
  },
  foundCents: 290_000,
  savedCents: 0,
  ...over,
});

const areas = (over: Partial<AreasInput> = {}): AreasInput => ({
  parts: [],
  suggestions: [],
  safeShort: false,
  money: {
    months: [
      { month: "2026-09", spendingCents: 410_000 },
      { month: "2026-10", spendingCents: 231_000 },
    ],
    budgetsOver: 0,
  },
  insurance: { policies: 2, gaps: 0 },
  loans: {
    owedCents: 840_000,
    lines: [
      { name: "Card", balanceCents: 240_000, overdue: false },
      { name: "Car loan", balanceCents: 600_000, overdue: false },
    ],
  },
  taxes: {
    totalTaxCents: 800_000,
    paidCents: 600_000,
    refundCents: -200_000,
    withholdingKnown: true,
  },
  investments: {
    totalCents: 1_020_000,
    paidInCents: 1_000_000,
    parts: [
      { label: "VTI", valueCents: 700_000 },
      { label: "Cash", valueCents: 320_000 },
    ],
  },
  ahead: {
    goals: [
      { name: "Trip", percent: 40, onTrack: true },
      { name: "Car", percent: 80, onTrack: false },
    ],
  },
  ...over,
});

const tileOf = (input: AreasInput, key: string) => tilesView(input).find((t) => t.key === key)!;

describe("shortMoney", () => {
  it("reads in a glance", () => {
    expect(shortMoney(64_000)).toBe("$640");
    expect(shortMoney(231_000)).toBe("$2.3k");
    expect(shortMoney(100_000)).toBe("$1k");
    expect(shortMoney(4_820_000)).toBe("$48k");
    expect(shortMoney(130_000_000)).toBe("$1.3M");
    expect(shortMoney(-840_000)).toBe("-$8.4k");
  });
});

describe("the hero row", () => {
  it("splits today's balance into where it goes, and says until when", () => {
    const { safe } = heroView(hero());
    expect(safe?.label).toBe("Safe to spend until Oct 31");
    expect(safe?.cents).toBe(120_000);
    expect(safe?.short).toBe(false);
    expect(safe?.parts.map((p) => p.key)).toEqual(["bills", "budgets", "goals", "safe"]);
    expect(safe?.parts.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1);
  });

  it("says how short, when bills come to more than the balance", () => {
    const { safe } = heroView(
      hero({
        safe: { ...hero().safe!, payday: null, safeCents: -5_000 },
      }),
    );
    expect(safe).toMatchObject({ label: "Safe to spend", cents: 5_000, short: true });
    expect(safe?.parts.some((p) => p.key === "safe")).toBe(false);
  });

  it("draws net worth from the months with balances, and its direction", () => {
    const { netWorth } = heroView(hero());
    expect(netWorth?.cents).toBe(4_820_000);
    expect(netWorth?.points.map((p) => p.month)).toEqual(["2025-11", "2026-10"]);
    expect(netWorth?.trend).toBe("up");
    const flat = heroView(
      hero({
        netWorth: {
          todayCents: 100,
          months: [
            { month: "2025-11", netCents: 1_000_000 },
            { month: "2026-10", netCents: 1_005_000 },
          ],
        },
      }),
    );
    expect(flat.netWorth?.trend).toBe("flat");
  });

  it("shows money saved once there is some, and money found before", () => {
    expect(heroView(hero()).saved).toMatchObject({ label: "Money found", cents: 290_000 });
    expect(heroView(hero({ savedCents: 64_000 })).saved).toMatchObject({
      label: "Saved so far",
      cents: 64_000,
    });
    expect(heroView(hero({ savedCents: 64_000 })).saved.share).toBeCloseTo(64_000 / 290_000);
  });

  it("says how much of it the person's transactions confirm (the verified savings record)", () => {
    expect(heroView(hero({ savedCents: 64_000 })).saved.confirmedCents).toBe(0);
    expect(heroView(hero({ savedCents: 64_000, confirmedCents: 21_588 })).saved).toMatchObject({
      label: "Saved so far",
      cents: 64_000,
      confirmedCents: 21_588,
    });
    // Confirmed with nothing still expected (a refund that came back): still "Saved so far".
    expect(heroView(hero({ savedCents: 0, confirmedCents: 4_500 })).saved).toMatchObject({
      label: "Saved so far",
      cents: 4_500,
      confirmedCents: 4_500,
    });
  });

  it("says why safe to spend is that number, lines that add up to it", () => {
    const { safe } = heroView(hero());
    // The balance now, less each thing held back, equals it (founder: "a summary on why that
    // number is what it is"); nothing held back at zero is listed.
    expect(safe?.why).toEqual([
      { label: "In checking now", sign: "", cents: 300_000 },
      { label: "Bills before Oct 31", sign: "−", cents: 120_000 },
      { label: "Left in your budgets", sign: "−", cents: 40_000 },
      { label: "Goals this month", sign: "−", cents: 20_000 },
      { label: "Safe to spend", sign: "=", cents: 120_000 },
    ]);
    const [balance, ...rest] = safe!.why;
    const total = rest.at(-1)!;
    const held = rest.slice(0, -1).reduce((sum, l) => sum + l.cents, 0);
    expect(balance.cents - held).toBe(total.cents);
    const short = heroView(hero({ safe: { ...hero().safe!, safeCents: -5_000 } })).safe;
    expect(short?.why.at(-1)).toEqual({ label: "Short before payday", sign: "=", cents: -5_000 });
  });

  it("says where the savings came from, the biggest few, and how many more", () => {
    const items = [
      { title: "Cancel Hulu", kind: "cancelled" as const, cents: 21_600, yearly: true },
      { title: "Get the overdraft fee back", kind: "refund" as const, cents: 3_500, yearly: false },
      { title: "Lower your phone bill", kind: "cheaper" as const, cents: 24_000, yearly: true },
      { title: "Move idle cash", kind: "interest" as const, cents: 15_000, yearly: true },
    ];
    const { saved } = heroView(hero({ savedCents: 64_100, savedItems: items }));
    expect(saved.items.map((i) => i.title)).toEqual(items.slice(0, 3).map((i) => i.title));
    expect(saved.more).toBe(1);
    // Before anything is saved, there's nothing to open.
    expect(heroView(hero()).saved).toMatchObject({ items: [], more: 0 });
  });

  it("leaves out what isn't known", () => {
    const view = heroView(hero({ safe: null, netWorth: null }));
    expect(view.safe).toBeNull();
    expect(view.netWorth).toBeNull();
  });
});

describe("the cash-flow strip's markers", () => {
  const e = (key: string, kind: "bill" | "pay" | "deadline", day: number, weight = 0.5) => ({
    key,
    kind,
    day,
    date: `2026-11-${String(day).padStart(2, "0")}`,
    label: key,
    amountCents: 1_000,
    weight,
    href: null,
  });

  it("makes a day's events of one kind one marker, sized by the biggest, listing them all", () => {
    const groups = cashGroups([
      e("rent", "bill", 8, 1),
      e("phone", "bill", 8, 0.2),
      e("pay", "pay", 8),
      e("netflix", "bill", 3),
    ]);
    expect(groups.map((g) => [g.kind, g.day, g.events.map((x) => x.key)])).toEqual([
      ["bill", 3, ["netflix"]],
      ["pay", 8, ["pay"]],
      ["bill", 8, ["rent", "phone"]],
    ]);
    expect(groups[2].weight).toBe(1);
  });
});

describe("the cash-flow strip", () => {
  const strip = cashFlowView({
    asOf: ASOF,
    bills: [
      { merchant: "Rent", date: "2026-11-01", amountCents: 145_000 },
      { merchant: "Netflix", date: "2026-10-25", amountCents: 1_799 },
      { merchant: "Gym", date: "2026-12-30", amountCents: 4_000 },
    ],
    deposits: [{ merchant: "Payroll", date: "2026-10-31", amountCents: 250_000 }],
    deadlines: [
      { key: "netflix", title: "Netflix renews", date: "2026-10-25", href: "/subscriptions" },
      { key: "trial", title: "Trial ends", date: "2026-10-28", href: null },
    ],
  });

  it("puts the next 30 days in date order, each sized against its own kind", () => {
    expect(strip.days).toBe(30);
    expect(strip.events.map((e) => [e.kind, e.day, e.label])).toEqual([
      ["bill", 2, "Netflix"],
      ["deadline", 5, "Trial ends"],
      ["pay", 8, "Payroll"],
      ["bill", 9, "Rent"],
    ]);
    expect(strip.events.find((e) => e.label === "Rent")?.weight).toBe(1);
    expect(strip.events.find((e) => e.label === "Payroll")?.weight).toBe(1);
  });

  it("leaves out a deadline that is a bill already on the strip", () => {
    expect(strip.events.some((e) => e.label === "Netflix renews")).toBe(false);
  });

  it("links a deadline without a page to the deadlines", () => {
    expect(strip.events.find((e) => e.label === "Trial ends")?.href).toBe("/deadlines");
  });
});

describe("the area tiles", () => {
  it("are the six areas in tab order, each opening its tab", () => {
    const tiles = tilesView(areas());
    expect(tiles.map((t) => t.label)).toEqual([
      "Spending & bills",
      "Insurance",
      "Loans & credit",
      "Taxes",
      "Investing (practice)",
      "Plans & goals",
    ]);
    expect(tiles.map((t) => t.href)).toEqual([
      "/money",
      "/insurance",
      "/loans",
      "/taxes",
      "/investments",
      "/ahead",
    ]);
  });

  it("show one number each, short", () => {
    expect(tilesView(areas()).map((t) => t.value)).toEqual([
      "$2.3k",
      "2 policies",
      "$8.4k",
      "$2k",
      "$10k",
      "1 of 2",
    ]);
    expect(tileOf(areas(), "taxes").caption).toBe("To pay, estimated");
    expect(
      tileOf(areas({ taxes: { ...areas().taxes!, refundCents: 50_000 } }), "taxes").value,
    ).toBe("+$500");
  });

  it("are good with nothing to look at", () => {
    const tiles = tilesView(
      areas({ ahead: { goals: [{ name: "Trip", percent: 40, onTrack: true }] } }),
    );
    expect(tiles.map((t) => t.health)).toEqual(["good", "good", "good", "good", "good", "good"]);
  });

  it("ask for a look when a suggestion waits in the area, or a part of the score is weak", () => {
    const input = areas({
      suggestions: [{ capability: "subscriptions", urgency: "later" }],
      parts: [{ part: "cards", points: 4, max: 20 }],
    });
    expect(tileOf(input, "money")).toMatchObject({ health: "look", healthWhy: "1 idea for you" });
    expect(tileOf(input, "loans")).toMatchObject({ health: "look", healthWhy: "Room to improve" });
    expect(tileOf(input, "taxes").health).toBe("good");
  });

  it("ask to act on something urgent, an overdue payment or a short balance", () => {
    expect(
      tileOf(areas({ suggestions: [{ capability: "insurance", urgency: "now" }] }), "insurance"),
    ).toMatchObject({ health: "act", healthWhy: "1 thing to do now" });
    const overdue = areas({
      loans: { owedCents: 1, lines: [{ name: "Card", balanceCents: 1, overdue: true }] },
    });
    expect(tileOf(overdue, "loans")).toMatchObject({
      health: "act",
      healthWhy: "1 payment overdue",
    });
    expect(tileOf(areas({ safeShort: true }), "money").health).toBe("act");
  });

  it("say what is behind, without a suggestion", () => {
    expect(tileOf(areas(), "ahead")).toMatchObject({ health: "look", healthWhy: "1 goal behind" });
    expect(tileOf(areas({ insurance: { policies: 1, gaps: 2 } }), "insurance")).toMatchObject({
      value: "2 gaps",
      health: "look",
    });
  });

  it("say what to set up when an area has nothing yet", () => {
    const empty = tilesView(
      areas({
        money: null,
        insurance: null,
        loans: null,
        taxes: null,
        investments: null,
        ahead: null,
      }),
    );
    expect(empty.every((t) => t.health === null && t.value === null)).toBe(true);
    expect(empty.every((t) => t.chart.kind === "none")).toBe(true);
    expect(empty.map((t) => t.healthWhy)).toEqual(Array(6).fill("Not set up"));
  });

  it("draw each chart from the area's own figures, largest first", () => {
    expect(tileOf(areas(), "money").chart).toEqual({
      kind: "bars",
      values: [410_000, 231_000],
      labels: ["Sep", "Oct"],
    });
    const loans = tileOf(areas(), "loans").chart;
    expect(loans.kind === "split" && loans.parts.map((p) => p.label)).toEqual(["Car loan", "Card"]);
    expect(tileOf(areas(), "taxes").chart).toMatchObject({ kind: "meter", share: 0.75 });
  });

  it("say what each chart shows, for screen readers", () => {
    expect(chartText(tileOf(areas(), "money").chart)).toBe("Sep $4,100, Oct $2,310");
    expect(chartText(tileOf(areas(), "insurance").chart)).toBe("2 policies, 0 gaps");
    expect(chartText(tileOf(areas(), "ahead").chart)).toBe("Trip 40%; Car 80%, behind");
  });
});
