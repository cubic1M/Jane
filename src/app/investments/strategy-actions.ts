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
  // Back to the same card, drawn afresh: the investing tree opens on More strategies.
  revalidatePath("/investments");
  redirect("/investments?focus=strategies:menu");
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
  redirect("/investments?focus=strategies:menu");
}

// "Use in practice" on a day-trading card, and "Stop day trading" (Very high only): the
// day-trading sleeve, through the same check, turned on only at a level that has one.
export async function usePracticeDayTrading(formData: FormData): Promise<void> {
  const user = await demoUser();
  const rule = String(formData.get("rule") ?? "");
  if (user && Object.hasOwn(DAY_TRADING_CHOICES, rule)) {
    const { level } = await practiceProfileOf(user.id);
    if (rule === "off" || INTRADAY_SLEEVE_BY_LEVEL[level] !== undefined) {
      await savePreferences(user.id, { dayTrading: rule }, "page");
    }
  }
  revalidatePath("/investments");
  redirect("/investments?focus=strategies:menu");
}

// "Use in practice" on a tested strategy, and "Back to your mix": only one the research rates
// worth watching or recommendable at the person's level (src/config/catalog-evidence.ts).
export async function usePracticeCatalog(formData: FormData): Promise<void> {
  const user = await demoUser();
  const strategy = String(formData.get("strategy") ?? "");
  if (user && (strategy === "off" || Object.hasOwn(CATALOG, strategy))) {
    const { level } = await practiceProfileOf(user.id);
    const e = strategy === "off" ? null : CATALOG_EVIDENCE[strategy as CatalogId]?.[level];
    if (strategy === "off" || (e && (e.watch || e.recommendable)))
      await savePreferences(user.id, { catalogStrategy: strategy }, "page");
  }
  revalidatePath("/investments");
  redirect("/investments?focus=strategies:menu");
}
