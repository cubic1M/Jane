"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { runPaperDay } from "@/lib/paper/account";
import { CATALOG_EVIDENCE } from "@/config/catalog-evidence";
import { CRYPTO_SLEEVE_BY_LEVEL } from "@/config/crypto-strategies";
import { CATALOG, type CatalogId } from "@/config/strategy-catalog";
import { CRYPTO_SLEEVE_CHOICES } from "@/config/practice-preferences";
import { adviceMode } from "@/lib/advice-mode";
import { practiceProfileOf, savePreferences } from "@/lib/practice/preferences";
import { requireUser } from "@/lib/session";

// Every button here is demo advice: a real account's settings never change through them.
async function demoUser() {
  const user = await requireUser();
  return (await adviceMode(user.id)) ? user : null;
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
  // The paper account follows the new strategy: its trades wait in the pop-up straight away.
  after(() =>
    runPaperDay(user.id).then(
      () => undefined,
      () => undefined,
    ),
  );
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
