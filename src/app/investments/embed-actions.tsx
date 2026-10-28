"use server";

import type { ReactNode } from "react";
import { isHiddenPage } from "@/config/hidden-pages";
import { requireUser } from "@/lib/session";
import { FeesBody } from "./fees/body";
import { ShortTermBody } from "./short-term/body";
import { SuddenMoneyBody } from "./sudden-money/body";
import { ValuesBody } from "./values/body";

// The smallest sub-pages, opened inside the Investing tree when the person taps them: the page's
// data loads here, only then, and its own forms keep working. A page the read-only beta hides
// (src/config/hidden-pages.ts) isn't offered; everything else stays a link.
export async function embedPage(key: string): Promise<ReactNode> {
  await requireUser();
  const href = ["", "investments", key].join("/");
  if (isHiddenPage(href)) return null;
  switch (key) {
    case "fees":
      return <FeesBody embed />;
    case "short-term":
      return <ShortTermBody embed />;
    case "sudden-money":
      return <SuddenMoneyBody embed />;
    case "values":
      return <ValuesBody embed />;
    default:
      return null;
  }
}
