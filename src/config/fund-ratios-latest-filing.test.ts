import { describe, expect, it } from "vitest";
import { formatExpenseRatio } from "@/lib/percent";
import { REAL_FUND_FACTS } from "./funds";

// Every fund in the table with a filing, checked on 11-20 against its share class's
// oef:ExpensesOverAssets in the newest 485BPOS or 497 on sec.gov that carries the class (series and
// class from the SEC's fund ticker list). Kept to whole basis points, the table once held FXAIX at
// 1 (#2169) and FXNAX at 3 (#2198); these hold the half basis points where a filing has one, and
// Fidelity's index funds that weren't in the table at all (a holding with no entry shows "not
// known"). Each: basis points, the filing's day, its folder on sec.gov.
const FILINGS = {
  // Fidelity Concord Street Trust, 2026-04-24; Fidelity Salem Street Trust, 2026-06-24 and
  // 2025-12-29 (the zero funds); Fidelity Contrafund, 2026-02-24.
  FXAIX: [1.5, "2026-04-24", "819118/000081911826000072"],
  FSKAX: [1.5, "2026-04-24", "819118/000081911826000072"],
  FSMAX: [3.5, "2026-04-24", "819118/000081911826000072"],
  FSPSX: [3.5, "2026-04-24", "819118/000081911826000072"],
  FSMDX: [2.5, "2026-06-24", "35315/000003531526000387"],
  FSSNX: [2.5, "2026-06-24", "35315/000003531526000387"],
  FSPGX: [3.5, "2026-06-24", "35315/000003531526000387"],
  FLCOX: [3.5, "2026-06-24", "35315/000003531526000387"],
  FZROX: [0, "2025-12-29", "819118/000081911825000470"],
  FZILX: [0, "2025-12-29", "819118/000081911825000470"],
  FTIHX: [6, "2025-12-29", "35315/000003531525001299"],
  FCNTX: [74, "2026-02-24", "24238/000002423826000028"],
  // Vanguard.
  VTI: [3, "2026-04-28", "36405/000003640526000181"],
  VOO: [3, "2026-04-28", "36405/000003640526000181"],
  VUG: [3, "2026-04-28", "36405/000003640526000181"],
  VTV: [3, "2026-04-28", "36405/000003640526000181"],
  VTSAX: [4, "2026-04-28", "36405/000003640526000181"],
  VFIAX: [4, "2026-04-28", "36405/000003640526000181"],
  VXUS: [5, "2026-02-27", "736054/000119312526077488"],
  VTIAX: [9, "2026-02-27", "736054/000119312526077488"],
  VEA: [3, "2026-04-28", "923202/000092320226000059"],
  VWO: [6, "2026-02-27", "857489/000119312526077485"],
  VT: [6, "2026-02-27", "857489/000119312526077485"],
  BND: [3, "2026-04-28", "794105/000079410526000106"],
  VBTLX: [4, "2026-04-28", "794105/000079410526000106"],
  VNQ: [13, "2026-05-28", "734383/000073438326000129"],
  // Schwab.
  SCHB: [3, "2025-12-22", "1454889/000110465925123308"],
  SCHX: [3, "2025-12-22", "1454889/000110465925123308"],
  SCHD: [6, "2025-12-22", "1454889/000110465925123308"],
  SCHF: [3, "2025-12-22", "1454889/000110465925123308"],
  SWTSX: [3, "2026-02-26", "904333/000088454626000041"],
  SWPPX: [2, "2026-02-26", "904333/000088454626000041"],
  // iShares, Invesco, ARK.
  IEFA: [7, "2025-11-21", "1100663/000119312525291438"],
  IEMG: [9, "2025-12-19", "930667/000119312525327007"],
  AGG: [3, "2026-06-18", "1100663/000119312526275730"],
  QQQ: [18, "2025-12-19", "1067839/000110465925123273"],
  ARKK: [75, "2025-11-26", "1579982/000121390025115285"],
} as const;

describe("each fund's yearly cost is its latest filing's", () => {
  it.each(Object.entries(FILINGS))("%s", (ticker, [bps, filed, folder]) => {
    const facts = REAL_FUND_FACTS[ticker]!;
    expect(facts.expenseRatioBps).toBe(bps);
    expect(facts.asOf).toBe(filed);
    expect(facts.source).toBe(
      `SEC 485BPOS filed ${filed}, fee table: https://www.sec.gov/Archives/edgar/data/${folder}/`,
    );
  });

  it("shows a half basis point, and a zero fund as costing nothing", () => {
    expect(formatExpenseRatio(REAL_FUND_FACTS.FSMDX!.expenseRatioBps)).toBe("0.025%");
    expect(formatExpenseRatio(REAL_FUND_FACTS.FSMAX!.expenseRatioBps)).toBe("0.035%");
    expect(formatExpenseRatio(REAL_FUND_FACTS.FZROX!.expenseRatioBps)).toBe("0.00%");
  });
});
