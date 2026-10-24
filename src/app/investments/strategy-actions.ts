"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CRYPTO_SLEEVE_BY_LEVEL } from "@/config/crypto-strategies";
import { INTRADAY_SLEEVE_BY_LEVEL } from "@/config/intraday-strategies";
import {
  CRYPTO_SLEEVE_CHOICES,
  DAY_TRADING_CHOICES,
  STRATEGY_CHOICES,
} from "@/config/practice-preferences";
import { practiceProfileOf, savePreferences } from "@/lib/practice/preferences";
import { requireUser } from "@/lib/session";

// "Use in practice" on a strategy menu card (Phase AW, Stage A): the practice portfolio's
// strategy, saved through the same check as the settings page. Practice money only.
export async function usePracticeStrategy(formData: FormData): Promise<void> {
  const user = await requireUser();
  const strategy = String(formData.get("strategy") ?? "");
  if (Object.hasOwn(STRATEGY_CHOICES, strategy)) {
    await savePreferences(user.id, { strategy }, "page");
  }
  // Back to the same card, drawn afresh: the investing tree opens on More strategies.
  revalidatePath("/investments");
  redirect("/investments?focus=strategies:menu");
}

// "Use in practice" on a crypto card, and "Turn the sleeve off" (Very high only): the crypto
// sleeve, through the same check. A sleeve is turned on only at a level that has one.
export async function usePracticeCrypto(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sleeve = String(formData.get("sleeve") ?? "");
  if (Object.hasOwn(CRYPTO_SLEEVE_CHOICES, sleeve)) {
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
  const user = await requireUser();
  const rule = String(formData.get("rule") ?? "");
  if (Object.hasOwn(DAY_TRADING_CHOICES, rule)) {
    const { level } = await practiceProfileOf(user.id);
    if (rule === "off" || INTRADAY_SLEEVE_BY_LEVEL[level] !== undefined) {
      await savePreferences(user.id, { dayTrading: rule }, "page");
    }
  }
  revalidatePath("/investments");
  redirect("/investments?focus=strategies:menu");
}
