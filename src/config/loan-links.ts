import { STUDENT_STEPS } from "./student-loans";

// Every link Jane gives for a loan, in one list (connectors roadmap round 15): plain, unpaid links
// to the government's own pages and to lenders' home pages, never an affiliate link. Round 14 and
// 15 keep every loan product unpaid in the beta (California, Connecticut and RESPA: a referral
// paid per application or per funded loan is the riskiest model), so `paid` is false for all,
// and a test holds every URL to carrying no affiliate tag and nothing about the person.
//
// - government: studentaid.gov's own tools, for anyone.
// - lender: one lender's home page. Named lenders are a pick, so they're shown in demo advice
//   mode only (REAL_ACCOUNT_ADVICE stays false); a real account gets Jane's arithmetic and the
//   government pages.
// - marketplace: Engine's hosted page, once Engine gives Jane its address (a founder task).

export type LoanProduct =
  | "student_federal"
  | "student_refinance"
  | "auto_refinance"
  | "mortgage_refinance"
  | "personal_loan";

export type LoanLink = {
  id: string;
  product: LoanProduct;
  kind: "government" | "lender" | "marketplace";
  label: string;
  // Null until it's known: a marketplace page waits for its partner.
  url: string | null;
  paid: false;
  adviceModeOnly: boolean;
};

const government = STUDENT_STEPS.map((step): LoanLink => ({
  id: `studentaid_${step.key}`,
  product: "student_federal",
  kind: "government",
  label: step.title,
  url: step.url,
  paid: false,
  adviceModeOnly: false,
}));

// Private student refinance lenders named in round 15 (their home pages, nothing else).
const lenders: LoanLink[] = [
  ["sofi", "SoFi", "https://www.sofi.com/"],
  ["earnest", "Earnest", "https://www.earnest.com/"],
  ["elfi", "ELFI", "https://www.elfi.com/"],
  ["lendkey", "LendKey", "https://www.lendkey.com/"],
  ["citizens", "Citizens", "https://www.citizensbank.com/"],
].map(([id, label, url]) => ({
  id: `refi_${id}`,
  product: "student_refinance",
  kind: "lender",
  label: label!,
  url: url!,
  paid: false,
  adviceModeOnly: true,
}));

// Engine's hosted lending page (round 14: a link-out, so no SSN or income passes through Jane).
const marketplaces: LoanLink[] = (
  ["auto_refinance", "mortgage_refinance", "personal_loan", "student_refinance"] as const
).map((product) => ({
  id: `engine_${product}`,
  product,
  kind: "marketplace",
  label: "Compare offers at Engine",
  url: null,
  paid: false,
  adviceModeOnly: false,
}));

export const LOAN_LINKS: readonly LoanLink[] = [...government, ...lenders, ...marketplaces];

// The links Jane may show this person for a product.
export const loanLinksFor = (product: LoanProduct, { adviceMode }: { adviceMode: boolean }) =>
  LOAN_LINKS.filter(
    (link) => link.product === product && link.url !== null && (adviceMode || !link.adviceModeOnly),
  );
