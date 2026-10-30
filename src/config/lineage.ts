// Where every user-owned table's rows come from, and how a derived row dies with its evidence
// (card-chat mismatch; the design is in the shared notes, card-chat-mismatch.md). The lineage
// test (src/config/lineage.test.ts) reads prisma/schema.prisma and fails when a model with a
// userId isn't listed here, so a new table says how it goes when its source goes.
//
// - source: written by a data source (a bank link, an upload, the demo bank); deleting the
//   source deletes these (foreign keys, ON DELETE CASCADE).
// - entered: the person typed or chose it; it is theirs whatever is linked.
// - derived: worked out from source rows, with how it is retired once they're gone:
//   - evidence: names its source rows; removeOrphans deletes it when they're all gone
//     (src/lib/evidence/orphans.ts), and the evidence gate drops it on the way to a surface;
//   - cascade: hangs off a derived row by foreign key and goes with it;
//   - rescan: worked out again on every scan, which drops what no longer applies;
//   - recheck: checked against the data each time it shows (src/lib/jane-agent/still-true.ts);
//   - stamp: a saved copy refused once the data changes (src/lib/data-stamp.ts).
// - record: a dated record of what happened or was said then (a report, a log, a trade on the
//   simulated paper account); history, not a claim about the person's data now.
// - system: sign-in, settings and bookkeeping of the app itself.

export type Lineage =
  | "source"
  | "entered"
  | "record"
  | "system"
  | { derived: "evidence" | "cascade" | "rescan" | "recheck" | "stamp" };

const evidence = { derived: "evidence" } as const;
const cascade = { derived: "cascade" } as const;
const rescan = { derived: "rescan" } as const;
const recheck = { derived: "recheck" } as const;
const stamp = { derived: "stamp" } as const;

export const LINEAGE: Readonly<Record<string, Lineage>> = {
  // Sign-in and the app's own bookkeeping.
  AuthAccount: "system",
  Session: "system",
  MfaBackupCode: "system",
  PushSubscription: "system",
  AnalyticsEvent: "system",
  ActivityEvent: "system",
  ReferralConversion: "system",
  ChatReplyLink: "system",
  ProblemReport: "system",
  // Caches of answers about merchants (is it a subscription, its category): not claims.
  SubscriptionCheck: "system",
  MerchantCategory: "system",

  // From the data sources.
  PlaidItem: "source",
  Account: "source",
  Transaction: "source",
  RecurringStream: "source",
  Liability: "source",
  BalanceSnapshot: "source",
  ImportRun: "source",
  Security: "source",
  Holding: "source",
  InvestmentTransaction: "source",
  CryptoConnection: "source",
  CryptoHolding: "source",
  Document: "source",
  TaxDocument: "source",
  HsaReceipt: "source",

  // Worked out from the data, and retired with it.
  Finding: evidence,
  SuggestionOutcome: evidence,
  Alert: evidence,
  Decision: cascade,
  Action: cascade,
  Suggestion: rescan,
  // A month summed up from the transactions: cleared with them.
  MonthClose: rescan,
  HealthScore: rescan,
  MonthlyReport: rescan,
  PlanProposal: rescan,
  DebtWatch: rescan,
  CarLoanWatch: rescan,
  BooksIssue: rescan,
  CostlyProduct: rescan,
  InsuranceRisk: rescan,
  InsuranceSaving: rescan,
  PolicyReading: rescan,
  TaxTag: rescan,
  PayrollChange: rescan,
  SuddenMoney: rescan,

  PracticeOpportunity: rescan,
  JaneMessage: recheck,
  JanePreference: stamp,
  UserFact: rescan,

  // What the person typed or chose.
  OwnedAsset: "entered",
  DebtTerms: "entered",
  DebtPlan: "entered",
  RefinanceCheck: "entered",
  LoanApplication: "entered",
  StudentLoanProfile: "entered",
  CreditReport: "entered",
  CardApplication: "entered",
  TightRequest: "entered",
  MedicalBill: "entered",
  MedicalRequest: "entered",
  CreditDispute: "entered",
  CardPromo: "entered",
  CardRateRequest: "entered",
  PersonalLoan: "entered",
  CreditGoal: "entered",
  HomeEquityFacts: "entered",
  CarAddon: "entered",
  RentReporting: "entered",
  BorrowingCheck: "entered",
  SecurityDeposit: "entered",
  FamilyCreditHelp: "entered",
  BalanceTransfer: "entered",
  MembershipIntent: "entered",
  HouseholdMember: "entered",
  HouseholdInvite: "entered",
  Budget: "entered",
  SavingsGoal: "entered",
  SharedCharge: "entered",
  Settlement: "entered",
  StandingRule: "entered",
  PlanLink: "entered",
  InsurancePolicy: "entered",
  InsuranceQuote: "entered",
  InsuranceShop: "entered",
  InsuranceClaim: "entered",
  DisasterLoss: "entered",
  EmployerBenefit: "entered",
  LifeApplication: "entered",
  CoverChange: "entered",
  RenewalNegotiation: "entered",
  InsuranceProfile: "entered",
  Deadline: "entered",
  LifeEvent: "entered",
  TaxProfile: "entered",
  TaxForm: "entered",
  InvestorProfile: "entered",
  ChangeAck: "entered",
  LifeEventAnswer: "entered",
  BudgetTuneUp: "entered",
  GoalTransfer: "entered",
  SavedShare: "entered",
  AutopilotSector: "entered",
  PriorReturn: "entered",
  DraftReturn: "entered",
  TaxAmendment: "entered",
  TaxNotice: "entered",
  TaxIdentityCase: "entered",
  EquityEvent: "entered",
  TaxPlanEvent: "entered",
  PropertyAppeal: "entered",
  AccountantLink: "entered",
  AccountantNote: "entered",
  TaxPayment: "entered",
  TaxReturn: "entered",
  AutoInvestPlan: "entered",
  CollegePlan: "entered",
  EquityGrant: "entered",
  PaycheckPlan: "entered",
  WhatIfPlan: "entered",
  LeanPlan: "entered",
  YearPlan: "entered",
  UnusualAnswer: "entered",
  OldPlan: "entered",
  RetirementIncome: "entered",
  FamilyChild: "entered",
  GiftLink: "entered",
  RentalProperty: "entered",
  PlanMenu: "entered",
  PlanChange: "entered",
  ValuesPreference: "entered",
  AccountBeneficiary: "entered",
  FamilyFile: "entered",
  InsuranceCheckup: "entered",
  PracticePreferences: "entered",
  // A Treasury-bill ladder the person set up (stand-in).
  BillLadder: "entered",

  // Dated records: what was said, done or traded at the time.
  Digest: "record",
  AskConversation: "record",
  AskMessage: "record",
  CheckIn: "record",
  AgentMessage: "record",
  AutopilotAct: "record",
  AutoInvestRun: "record",
  ControllerRun: "record",
  MoneyTransfer: "record",
  BrokerageOrder: "record",
  PracticePortfolio: "record",
  PracticePosition: "record",
  PracticeTrade: "record",
  PaperAccount: "record",
  PaperPosition: "record",
  PaperTrade: "record",
  PaperValue: "record",
  PaperSignal: "record",
  PaperEventOverlay: "record",
  PaperEventLog: "record",
};

// When none of the person's data is left (every bank disconnected, every upload removed: "Start
// over"), these are cleared outright: each is worked out from bank data and names no rows of its
// own (night debugger, 10-30: proposals, a learned rent payee, a found Geico policy and a month
// close all stayed after Start over). Prisma model to its scopedFor table (src/lib/evidence/orphans.ts clears them); the lineage test
// (./lineage.test.ts) fails when a derived table is in neither this nor KEPT_WITHOUT_DATA.
export const CLEARED_WITHOUT_DATA: Readonly<Record<string, string | [string, object]>> = {
  // Not a reshop of a policy the person entered: that stands on their policy, not bank data.
  Finding: ["findings", { type: { not: "insurance_reshop" } }],
  SuggestionOutcome: "suggestionOutcomes",
  Alert: "alerts",
  Suggestion: "suggestions",
  PlanProposal: "planProposals",
  DebtWatch: "debtWatches",
  CarLoanWatch: "carLoanWatches",
  BooksIssue: "booksIssues",
  CostlyProduct: "costlyProducts",
  TaxTag: "taxTags",
  PayrollChange: "payrollChanges",
  SuddenMoney: "suddenMoneys",
  MonthClose: "monthCloses",
  HealthScore: "healthScores",
  MonthlyReport: "monthlyReports",
};
// Derived, but not from bank data, so kept: from the person's policies, documents or the markets,
// or hanging off a row above.
export const KEPT_WITHOUT_DATA: Readonly<Record<string, string>> = {
  Decision: "goes with its finding (ON DELETE CASCADE)",
  Action: "goes with its decision (ON DELETE CASCADE)",
  InsuranceRisk: "from the person's policies and profile",
  InsuranceSaving: "from the person's policies and quotes",
  PolicyReading: "read from a document the person uploaded",
  PracticeOpportunity: "from market data, on the simulated practice account",
  JaneMessage: "the open ones are put away below, as history",
  JanePreference: "the saved numbers are refused by their data stamp",
  UserFact: "the ones read from statements go below; the person's own words stay",
};
