import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { AREA_KEYS } from "@/config/areas";
import { FAMILY_NAMES } from "@/config/feature-map";
import { DETECTORS } from "@/detectors";
import { DETECTOR_FAMILIES, buildFeatureMap, sampleExamples, topicName } from "./feature-map";
import { cameraFor, edgePath, layoutMap } from "./feature-map-layout";

// The feature map is generated from Jane's own registry (docs/design/home-hub.md): every
// detector is on it once, in its area, under its family's branch.

const examples = sampleExamples();
const maps = buildFeatureMap({ examples, reached: new Set(), advice: true });

describe("the feature map's data", () => {
  it("has every detector's family, and every family a name", () => {
    expect(DETECTOR_FAMILIES.flatMap((f) => f.detectors)).toHaveLength(DETECTORS.length);
    for (const d of DETECTORS) {
      expect(
        DETECTOR_FAMILIES.some((f) => f.detectors.includes(d)),
        d.topic,
      ).toBe(true);
    }
    for (const f of DETECTOR_FAMILIES) expect(FAMILY_NAMES[f.key], f.key).toBeTruthy();
  });

  it("puts every feature on the map once, in its area", () => {
    expect(maps.map((m) => m.key)).toEqual(AREA_KEYS);
    const ids = maps.flatMap((m) => m.branches.flatMap((b) => b.features.map((f) => f.id)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(new Set(DETECTORS.map((d) => `${d.capability}:${d.topic}`)).size);
    for (const m of maps) {
      expect(m.features).toBe(m.branches.reduce((n, b) => n + b.features.length, 0));
      expect(m.branches.length, m.key).toBeGreaterThan(0);
    }
  });

  it("names branches for their area when a family spans several", () => {
    const loans = maps.find((m) => m.key === "loans")!;
    const costs = loans.branches.find((b) => b.id === "loans/money");
    expect(costs?.name).toBe("Card and loan costs");
    expect(costs?.features.map((f) => f.name)).toContain("Card interest");
  });

  it("gives each feature one short line, an example from the sample people where there is one", () => {
    const all = maps.flatMap((m) => m.branches.flatMap((b) => b.features));
    const fees = all.find((f) => f.id === "cost:bank_fees")!;
    expect(fees.line).toMatch(/^Like: Stop paying overdraft and bank fees, save \$[\d,]+\/yr$/);
    expect(fees.href.startsWith("/")).toBe(true);
    for (const f of all) {
      expect(f.line.split(/\s+/).length, f.id).toBeLessThanOrEqual(14);
      expect(f.href.startsWith("/"), f.id).toBe(true);
      expect(f.ask).toMatch(/^What is .+, and does it apply to me\?$/);
    }
  });

  it("holds recommendations back from real accounts", () => {
    const real = buildFeatureMap({ examples, reached: new Set(), advice: false });
    const pmi = real
      .flatMap((m) => m.branches.flatMap((b) => b.features))
      .find((f) => f.id === "debt:pmi_removal")!;
    expect(pmi.line).toBe("Shown with demo data only");
    const fees = real
      .flatMap((m) => m.branches.flatMap((b) => b.features))
      .find((f) => f.id === "cost:bank_fees")!;
    expect(fees.line).toMatch(/^Like:/);
  });

  it("marks what has reached this person, and counts it up the tree", () => {
    const mine = buildFeatureMap({
      examples,
      reached: new Set(["cost:bank_fees", "subscriptions:subscriptions"]),
      advice: false,
    });
    const money = mine.find((m) => m.key === "money")!;
    expect(money.forYou).toBe(2);
    expect(money.branches.find((b) => b.id === "money/money")?.forYou).toBe(2);
    expect(money.branches.find((b) => b.id === "money/spending")?.forYou).toBe(0);
    const fees = money.branches.flatMap((b) => b.features).find((f) => f.id === "cost:bank_fees");
    expect(fees?.forYou).toBe(true);
  });

  it("reads topic ids as words", () => {
    expect(topicName("pmi_removal")).toBe("PMI removal");
    expect(topicName("s_corp_election")).toBe("S corp election");
    expect(topicName("irmaa_watch")).toBe("IRMAA watch");
    expect(topicName("hsa")).toBe("HSA");
    expect(topicName("bank_fees")).toBe("Bank fees");
  });
});

describe("the feature map's layout", () => {
  const money = maps.find((m) => m.key === "money")!;

  it("puts the area, its branches and nothing else up front", () => {
    const shut = layoutMap(money, null, 1000);
    expect(shut.nodes.filter((n) => n.level === 1)).toHaveLength(1);
    expect(shut.nodes.filter((n) => n.level === 2)).toHaveLength(money.branches.length);
    expect(shut.nodes.filter((n) => n.level === 3)).toHaveLength(0);
    expect(shut.edges).toHaveLength(money.branches.length);
    expect(shut.focus).toEqual({ x: 0, y: 0, w: shut.width, h: shut.height });
  });

  it("opens a branch beside it, its features centred on it and joined to it", () => {
    const branch = money.branches[0];
    const open = layoutMap(money, branch.id, 1000);
    const features = open.nodes.filter((n) => n.level === 3);
    expect(features.map((n) => n.id)).toEqual(branch.features.map((f) => f.id));
    expect(features.every((n) => n.y >= 0)).toBe(true);
    const box = open.nodes.find((n) => n.id === branch.id)!;
    expect(features.every((n) => n.x > box.x + box.w)).toBe(true);
    expect(open.edges.filter((e) => e.id.startsWith(`${branch.id}>`))).toHaveLength(
      branch.features.length,
    );
    expect(open.height).toBeGreaterThanOrEqual(features.at(-1)!.y + features.at(-1)!.h);
    // The camera frames the branch and its features.
    expect(open.focus.x).toBe(box.x);
  });

  it("zooms to the features alone on a phone", () => {
    const branch = money.branches[0];
    const phone = layoutMap(money, branch.id, 343);
    const first = phone.nodes.find((n) => n.level === 3)!;
    expect(phone.focus.x).toBeLessThan(first.x);
    expect(phone.focus.x + phone.focus.w).toBe(first.x + first.w);
    expect(cameraFor(phone.focus, 343).scale).toBeGreaterThan(0.95);
  });

  it("never zooms past full size or below the floor, and never shows space left of the map", () => {
    expect(cameraFor({ x: 0, y: 0, w: 200, h: 100 }, 1000)).toEqual({ scale: 1, x: 0 });
    expect(cameraFor({ x: 0, y: 0, w: 4000, h: 100 }, 400).scale).toBe(0.55);
    const panned = cameraFor({ x: 600, y: 0, w: 400, h: 100 }, 400);
    expect(panned).toEqual({ scale: 1, x: -600 });
  });

  it("draws each edge as a curve from parent to child", () => {
    expect(edgePath({ id: "e", from: { x: 0, y: 10 }, to: { x: 100, y: 50 } })).toBe(
      "M0,10 C50,10 50,50 100,50",
    );
  });
});
