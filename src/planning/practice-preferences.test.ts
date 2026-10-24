import { describe, expect, it } from "vitest";
import { PRACTICE_STOCKS, PRACTICE_UNIVERSE, classOf } from "@/config/portfolios";
import { AVOID_MAX, EXCLUSIONS, TICKER_TAGS } from "@/config/practice-preferences";
import { VALUES_EXCLUSIONS } from "@/config/values";
import {
  applyPatch,
  avoidKey,
  DEFAULT_PREFERENCES,
  describeChanges,
  fromRow,
  parsePreferenceForm,
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

  it("takes a crypto sleeve choice, and nothing else for it", () => {
    const r = applyPatch(base(), { cryptoSleeve: "crypto_trend" }, TODAY);
    expect(r.ok && r.preferences.cryptoSleeve).toBe("crypto_trend");
    expect(r.ok && r.changed).toEqual(["cryptoSleeve"]);
    expect(applyPatch(base(), { cryptoSleeve: "dogecoin" }, TODAY).ok).toBe(false);
    const d = applyPatch(base(), { dayTrading: "vwap_reversion" }, TODAY);
    expect(d.ok && d.preferences.dayTrading).toBe("vwap_reversion");
    expect(applyPatch(base(), { dayTrading: "scalping" }, TODAY).ok).toBe(false);
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
      strategy: "moonshot",
      rebalancePace: "hourly",
      universe: "everything",
      maxFundPercent: 95,
      cryptoSleeve: "dogecoin",
      dayTrading: "scalping",
    });
    expect(p).toMatchObject({
      riskLevel: null,
      goal: null,
      goalDate: "2030-01-01",
      appetite: "normal",
      avoid: ["tobacco"],
      mode: "act",
      strategy: "level",
      cryptoSleeve: "off",
      dayTrading: "off",
      rebalancePace: "normal",
      universe: "funds_and_stocks",
      maxFundPercent: null,
    });
  });

  it("checks the strategy, the rebalance pace, what may be bought and the most in one fund", () => {
    const ok = applyPatch(
      base(),
      { strategy: "trend", rebalancePace: "rarely", universe: "funds_only", maxFundPercent: 40 },
      TODAY,
    );
    expect(ok.ok && ok.changed).toEqual([
      "strategy",
      "rebalancePace",
      "universe",
      "maxFundPercent",
    ]);
    expect(ok.ok && sayPreference(ok.preferences, "strategy")).toBe("Trend filter");
    const bad = applyPatch(
      base(),
      { strategy: "leverage", rebalancePace: "daily", universe: "crypto", maxFundPercent: 90 },
      TODAY,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(Object.keys(bad.errors).sort()).toEqual([
      "maxFundPercent",
      "rebalancePace",
      "strategy",
      "universe",
    ]);
    expect(bad.errors.maxFundPercent).toBe("Pick a share from 20% to 80%.");
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

  it("knows every exclusion from investing by your values (step 236), by the same key", () => {
    for (const key of Object.keys(VALUES_EXCLUSIONS)) expect(avoidKey(key)).toBe(key);
  });

  it("every company the portfolio may buy has its tags", () => {
    for (const t of PRACTICE_UNIVERSE) {
      if (classOf(t)) continue;
      expect(TICKER_TAGS[t], t).toBeDefined();
    }
    for (const t of PRACTICE_STOCKS) expect(TICKER_TAGS[t]).toBeDefined();
  });
});

describe("the settings page's form", () => {
  const form = (fields: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
    }
    return f;
  };
  const full = {
    riskLevel: "2",
    maxDropPercent: "",
    goal: "home",
    goalDate: "2030-06-01",
    monthlyAdd: "250.50",
    addDay: "15",
    appetite: "cautious",
    avoid: ["tobacco", "fossil_fuels"],
    avoidTickers: "tsla, VXUS",
    harvestLosses: "on",
    cashBuffer: "$1,000",
    mode: "suggest",
    strategy: "vol_target",
    rebalancePace: "often",
    universe: "funds_only",
    maxFundPercent: "50",
  };

  it("reads every field and passes the same check as the chat", () => {
    const patch = parsePreferenceForm(form(full));
    const r = applyPatch(base(), patch, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preferences).toEqual({
      riskLevel: 2,
      maxDropPercent: null,
      goal: "home",
      goalDate: "2030-06-01",
      monthlyAddCents: 25_050,
      addDay: 15,
      appetite: "cautious",
      avoid: ["tobacco", "fossil_fuels", "TSLA", "VXUS"],
      harvestLosses: true,
      cashBufferCents: 100_000,
      mode: "suggest",
      strategy: "vol_target",
      rebalancePace: "often",
      universe: "funds_only",
      maxFundPercent: 50,
      // Not on the form unless shown (Very high): left as it was.
      cryptoSleeve: "off",
      dayTrading: "off",
    });
    expect(parsePreferenceForm(form({ ...full, cryptoSleeve: "crypto_hold" })).cryptoSleeve).toBe(
      "crypto_hold",
    );
    // An empty cap on one fund is the hard limit.
    expect(parsePreferenceForm(form({ ...full, maxFundPercent: "" })).maxFundPercent).toBeNull();
  });

  it("an empty level follows the questionnaire, an unticked box is off, and bad numbers are refused", () => {
    const patch = parsePreferenceForm(form({ ...full, riskLevel: "", harvestLosses: [] }));
    expect(patch.riskLevel).toBeNull();
    expect(patch.harvestLosses).toBe(false);
    expect(applyPatch(base(), parsePreferenceForm(form({ ...full, addDay: "" })), TODAY).ok).toBe(
      false,
    );
    expect(
      applyPatch(base(), parsePreferenceForm(form({ ...full, monthlyAdd: "lots" })), TODAY).ok,
    ).toBe(false);
  });
});
