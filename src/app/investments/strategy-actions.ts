"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CATALOG_EVIDENCE } from "@/config/catalog-evidence";
import { CRYPTO_SLEEVE_BY_LEVEL } from "@/config/crypto-strategies";
import { CATALOG, type CatalogId } from "@/config/strategy-catalog";
import { INTRADAY_SLEEVE_BY_LEVEL } from "@/config/intraday-strategies";
import {
  CRYPTO_SLEEVE_CHOICES,
  DAY_TRADING_CHOICES,
  STRATEGY_CHOICES,
} from "@/config/practice-preferences";
import { adviceMode } from "@/lib/advice-mode";
import { practiceProfileOf, savePreferences } from "@/lib/practice/preferences";
import { requireUser } from "@/lib/session";

// Every button here is demo advice: a real account's settings never change through them.
async function demoUser() {
  const user = await requireUser();
  return (await adviceMode(user.id)) ? user : null;
}

// "Use in practice" on a strategy menu card (Phase AW, Stage A): the practice portfolio's
// strategy, saved through the same check as the settings page. Practice money only.
export async function usePracticeStrategy(formData: FormData): Promise<void> {
  const user = await demoUser();
  const strategy = String(formData.get("strategy") ?? "");
  if (user && Object.hasOwn(STRATEGY_CHOICES, strategy)) {
    await savePreferences(user.id, { strategy }, "page");
  }
  // Back to the same list, drawn afresh.
  revalidatePath("/investments");
  redirect("/investments");
}

// "Use in practice" on a crypto card, and "Turn the sleeve off" (Very high only): the crypto
// sleeve, through the same check. A sleeve is turned on only at a level that has one.
export async function usePracticeCrypto(formData: FormData): Promise<void> {
  const user = await demoUser();
  const sleeve = String(formData.get("sleeve") ?? "");
  if (user && Object.hasOwn(CRYPTO_SLEEVE_CHOICES, sleeve)) {
    const { level } = await practiceProfileOf(user.id);
    if (sleeve === "off" || CRYPTO_SLEEVE_BY_LEVEL[level] !== undefined) {
      await savePreferences(user.id, { cryptoSleeve: sleeve }, "page");
    }
  }
  revalidatePath("/investments");
  redirect("/investments");
}

// "Use in practice" on a day-trading card, and "Stop day trading" (Very high only): the
// day-trading sleeve, through the same check, turned on only at a level that has one.
export async function usePracticeDayTrading(formData: FormData): Promise<void> {
  const user = await demoUser();
  const rule = String(formData.get("rule") ?? "");
  if (user && Object.hasOwn(DAY_TRADING_CHOICES, rule)) {
    const { level } = await practiceProfileOf(user.id);
    // Every rule lost money after costs (src/config/intraday-evidence.ts): turning it off only.
    if (rule === "off") await savePreferences(user.id, { dayTrading: rule }, "page");
    void level;
    void INTRADAY_SLEEVE_BY_LEVEL;
  }
  revalidatePath("/investments");
  redirect("/investments");
}

// "Use in practice" on a tested strategy, and "Back to your mix": any the research tested at the
// person's level (src/config/catalog-evidence.ts) that runs on its own (not a sleeve).
export async function usePracticeCatalog(formData: FormData): Promise<void> {
  const user = await demoUser();
  const strategy = String(formData.get("strategy") ?? "");
  if (user && (strategy === "off" || Object.hasOwn(CATALOG, strategy))) {
    const { level } = await practiceProfileOf(user.id);
    const e = strategy === "off" ? null : CATALOG_EVIDENCE[strategy as CatalogId]?.[level];
    if (strategy === "off" || (e && CATALOG[strategy as CatalogId].kind !== "sleeve"))
      await savePreferences(user.id, { catalogStrategy: strategy }, "page");
  }
  revalidatePath("/investments");
  redirect("/investments");
}

// The strategy tree's "Use this strategy" (founder: instant, with Revert, as #732): a leaf's key
// ("default", "catalog:<id>", "crypto:<id>") saved through the same check, with what it replaced
// so Revert can put it back. No redirect: the page has already marked it.
export type StrategyPick = { catalogStrategy: string; strategy: string; cryptoSleeve: string };
export type ChooseResult = { ok: true; previous: StrategyPick } | { ok: false; error: string };

const NOT_DEMO = "Practice strategies run on the demo bank only.";

async function savePick(patch: Partial<StrategyPick>): Promise<ChooseResult> {
  const user = await demoUser();
  if (!user) return { ok: false, error: NOT_DEMO };
  const saved = await savePreferences(user.id, patch, "page");
  if (!saved.ok) return { ok: false, error: "That didn't go through. Try again." };
  revalidatePath("/investments");
  const b = saved.before;
  return {
    ok: true,
    previous: {
      catalogStrategy: b.catalogStrategy,
      strategy: b.strategy,
      cryptoSleeve: b.cryptoSleeve,
    },
  };
}

export async function choosePracticeStrategy(key: string): Promise<ChooseResult> {
  const user = await demoUser();
  if (!user) return { ok: false, error: NOT_DEMO };
  const { level } = await practiceProfileOf(user.id);
  const [kind, id = ""] = key.split(":");
  if (key === "default") return savePick({ catalogStrategy: "off", strategy: "level" });
  if (kind === "catalog" && Object.hasOwn(CATALOG, id)) {
    if (!CATALOG_EVIDENCE[id as CatalogId]?.[level] || CATALOG[id as CatalogId].kind === "sleeve")
      return { ok: false, error: "That one isn't offered at your level." };
    return savePick({ catalogStrategy: id });
  }
  if (kind === "crypto" && Object.hasOwn(CRYPTO_SLEEVE_CHOICES, id) && id !== "off") {
    if (CRYPTO_SLEEVE_BY_LEVEL[level] === undefined)
      return { ok: false, error: "Crypto is offered at Very high only." };
    return savePick({ cryptoSleeve: id });
  }
  return { ok: false, error: "That one isn't offered." };
}

// Revert: what a pick replaced, put back (the same checks apply).
export async function restorePracticeStrategy(previous: StrategyPick): Promise<ChooseResult> {
  return savePick({
    catalogStrategy: previous.catalogStrategy,
    strategy: previous.strategy,
    cryptoSleeve: previous.cryptoSleeve,
  });
}
