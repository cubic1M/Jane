import { describe, expect, it } from "vitest";
import { PRACTICE_STOCKS, PRACTICE_UNIVERSE, classOf } from "@/config/portfolios";
import { AVOID_MAX, EXCLUSIONS, TICKER_TAGS } from "@/config/practice-preferences";
import {
  applyPatch,
  avoidKey,
  DEFAULT_PREFERENCES,
  describeChanges,
  fromRow,
  PREFERENCE_FIELDS,
  PREFERENCE_LABELS,
  sayPreference,
} from "./practice-preferences";

const TODAY = "2026-10-22";
const base = () => ({ ...DEFAULT_PREFERENCES, avoid: [] as string[] });

describe("practice preferences", () => {
  it("starts on the defaults, following the questionnaire's level", () => {
    expect(DEFAULT_PREFERENCES.riskLevel).toBeNull();
    expect(DEFAULT_PREFERENCES.mode).toBe("act");
    expect(DEFAULT_PREFERENCES.appetite).toBe("normal");
    expect(DEFAULT_PREFERENCES.harvestLosses).toBe(true);
  });

  it("applies a good change and lists what changed", () => {
    const r = applyPatch(base(), { riskLevel: 2, appetite: "off", avoid: ["fossil fuels"] }, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preferences.riskLevel).toBe(2);
    expect(r.preferences.appetite).toBe("off");
    expect(r.preferences.avoid).toEqual(["fossil_fuels"]);
    expect(r.changed).toEqual(["riskLevel", "appetite", "avoid"]);
  });

  it("refuses a change whole when any value is bad", () => {
    const r = applyPatch(base(), { riskLevel: 2, addDay: 31 }, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors)).toEqual(["addDay"]);
  });

  it.each([
    ["riskLevel", 0],
    ["riskLevel", 6],
    ["riskLevel", "3"],
    ["maxDropPercent", 2],
    ["maxDropPercent", 90],
    ["maxDropPercent", 12.5],
    ["goal", "yacht"],
    ["goalDate", "2026-10-22"],
    ["goalDate", "2020-01-01"],
    ["goalDate", "2099-01-01"],
    ["goalDate", "next year"],
    ["monthlyAddCents", -1],
    ["monthlyAddCents", 10.5],
    ["monthlyAddCents", 2_000_000],
    ["addDay", 0],
    ["addDay", 29],
    ["appetite", "wild"],
    ["avoid", "oil"],
    ["avoid", ["oil-ish things"]],
    ["avoid", ["XOM"]],
    ["harvestLosses", "yes"],
    ["cashBufferCents", -100],
    ["cashBufferCents", 99_000_000],
    ["mode", "trade_real_money"],
    ["realMoney", true],
  ])("refuses %s = %j", (field, value) => {
    expect(applyPatch(base(), { [field]: value }, TODAY).ok).toBe(false);
  });

  it("knows exclusions by key or words and tickers the portfolio could buy", () => {
    expect(avoidKey("Fossil-Fuels")).toBe("fossil_fuels");
    expect(avoidKey("tsla")).toBe("TSLA");
    expect(avoidKey("vti")).toBe("VTI");
    expect(avoidKey("XOM")).toBeNull();
  });

  it("keeps each thing to avoid once", () => {
    const r = applyPatch(base(), { avoid: ["tech", "TECH", "AAPL", "aapl"] }, TODAY);
    expect(r.ok && r.preferences.avoid).toEqual(["tech", "AAPL"]);
    // Everything there is to avoid fits under the cap.
    const all = [...Object.keys(EXCLUSIONS), ...PRACTICE_UNIVERSE];
    expect(all.length).toBeLessThanOrEqual(AVOID_MAX);
    expect(applyPatch(base(), { avoid: all }, TODAY).ok).toBe(true);
  });

  it("clearing the goal clears its date", () => {
    const set = applyPatch(base(), { goal: "home", goalDate: "2030-06-01" }, TODAY);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    const cleared = applyPatch(set.preferences, { goal: null }, TODAY);
    expect(cleared.ok && cleared.preferences.goalDate).toBeNull();
    expect(cleared.ok && cleared.changed).toEqual(["goal", "goalDate"]);
  });

  it("an unchanged value isn't a change", () => {
    const r = applyPatch(base(), { appetite: "normal", mode: "act" }, TODAY);
    expect(r.ok && r.changed).toEqual([]);
  });

  it("reads a stored row, falling back to defaults for anything unreadable", () => {
    const p = fromRow({
      riskLevel: 9,
      maxDropPercent: 20,
      goal: "boat",
      goalDate: new Date("2030-01-01T00:00:00Z"),
      monthlyAddCents: 10_000,
      addDay: 3,
      appetite: "reckless",
      avoid: ["tobacco", "nonsense"],
      harvestLosses: false,
      cashBufferCents: 5_000,
      mode: "yolo",
    });
    expect(p).toMatchObject({
      riskLevel: null,
      goal: null,
      goalDate: "2030-01-01",
      appetite: "normal",
      avoid: ["tobacco"],
      mode: "act",
    });
  });

  it("says every field in words and describes a change", () => {
    const after = applyPatch(base(), { riskLevel: 2, cashBufferCents: 50_000 }, TODAY);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    for (const f of PREFERENCE_FIELDS) {
      expect(PREFERENCE_LABELS[f]).toBeTruthy();
      expect(sayPreference(after.preferences, f)).toBeTruthy();
    }
    expect(describeChanges(base(), after.preferences, after.changed)).toEqual([
      "Risk level: From your answers → Low",
      "Cash to keep: $0 → $500",
    ]);
  });

  it("every company the portfolio may buy has its tags", () => {
    for (const t of PRACTICE_UNIVERSE) {
      if (classOf(t)) continue;
      expect(TICKER_TAGS[t], t).toBeDefined();
    }
    for (const t of PRACTICE_STOCKS) expect(TICKER_TAGS[t]).toBeDefined();
  });
});
