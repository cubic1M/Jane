import { loadInsuranceArea } from "@/lib/area-pages/insurance-load";
import { loadInvestingArea } from "@/lib/area-pages/investing-load";
import { loadLoansArea } from "@/lib/area-pages/loans-load";
import { moneyTree } from "@/lib/area-pages/money";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { loadPlansArea } from "@/lib/area-pages/plans-load";
import { loadTaxesArea } from "@/lib/area-pages/taxes-load";
import type { AreaTrees } from "@/lib/giant-tree";

// Every area's own tree, from the same loaders its page uses: Home's tiles and its "What Jane
// does" tree both take their statuses from these (src/lib/hub/area-status.ts). A loader that
// fails leaves its area out: the tile keeps its own reading, and the tree shows what Jane looks
// for there.
const quietly = <T>(load: Promise<T>) => load.catch(() => undefined);

export async function loadAreaTrees(userId: string): Promise<AreaTrees> {
  const [insurance, loans, taxes, plans, investing, money] = await Promise.all([
    quietly(loadInsuranceArea(userId)),
    quietly(loadLoansArea(userId)),
    quietly(loadTaxesArea(userId)),
    quietly(loadPlansArea(userId)),
    quietly(loadInvestingArea(userId)),
    quietly(loadMoneyArea(userId).then(moneyTree)),
  ]);
  return {
    insurance: insurance?.area,
    loans: loans?.area,
    taxes: taxes?.area,
    ahead: plans?.area,
    investments: investing?.area,
    money,
  };
}
