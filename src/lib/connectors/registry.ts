import {
  HUMAN_REVIEW_READY,
  REAL_CONNECTORS,
  connectorsKilledByEnv,
  connectorsOn,
  type ConnectorCapability,
} from "@/config/connectors";
import { killed } from "@/config/kill-switches";
import { REAL_MONEY_MOVEMENT } from "@/config/money-movement";
import { isTrialUser } from "@/lib/trial-ids";
import { gated } from "./gate";
import { manualBillPay, manualOwnTransfer } from "./manual-pay/connector";
import { creditUpload } from "./credit-upload/connector";
import { myAidUpload } from "./my-aid/connector";
import { irsTranscriptUpload } from "./irs-transcript/connector";
import { taxFormUpload } from "./tax-form-upload/connector";
import { manualOpenSavings } from "./manual-pay/savings";
import { SANDBOX_CONNECTORS } from "./sandbox/adapters";
import type { Connector } from "./types";

// Every connector Jane knows, and whether one may be used for a person right now. Adapters register
// in CONNECTORS below; each is wrapped by the gate, so its acting methods need the pipeline's grant.

// Problems with a connector's own definition: a test runs this over every registered one.
export function definitionProblems(connector: Connector): string[] {
  const problems: string[] = [];
  const has = (capability: ConnectorCapability) => connector.capabilities.includes(capability);
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(connector.id)) problems.push("id must be snake_case");
  if (Boolean(connector.act) !== has("act"))
    problems.push("act and the act capability go together");
  if (Boolean(connector.prefill) !== has("prefill")) {
    problems.push("prefill and the prefill capability go together");
  }
  if (has("act") && !connector.prefill) problems.push("acting needs prefilled steps first");
  if (connector.cancel && !connector.act) problems.push("cancel without act");
  if (connector.scopes.length === 0) problems.push("needs at least one consent scope");
  return problems;
}

export function buildRegistry(connectors: readonly Connector[]): ReadonlyMap<string, Connector> {
  const registry = new Map<string, Connector>();
  for (const connector of connectors) {
    const problems = definitionProblems(connector);
    if (problems.length) throw new Error(`Connector ${connector.id}: ${problems.join("; ")}`);
    if (registry.has(connector.id))
      throw new Error(`Connector ${connector.id} is registered twice`);
    registry.set(connector.id, gated(connector));
  }
  return registry;
}

// The registered connectors: the sandbox adapters (./sandbox/), and real partners once each has a
// contract, counsel's answer and its switch in REAL_CONNECTORS.
const CONNECTORS: readonly Connector[] = [
  ...SANDBOX_CONNECTORS,
  // Real, but they reach nobody and move nothing: the person pays or moves it (./manual-pay/). Off
  // until their switches.
  manualBillPay,
  manualOwnTransfer,
  manualOpenSavings,
  // Real, read only, no vendor: the person's own report and score (./credit-upload/).
  creditUpload,
  // Real, read only, no vendor: the person's federal student loans from studentaid.gov (./my-aid/).
  myAidUpload,
  // Real, read only, no vendor: the person's own IRS account transcript (./irs-transcript/).
  irsTranscriptUpload,
  // Real, read only, no vendor: the person's own W-2s and 1099s (./tax-form-upload/).
  taxFormUpload,
];

let registry: ReadonlyMap<string, Connector> = buildRegistry(CONNECTORS);

export const connectorById = (id: string): Connector | null => registry.get(id) ?? null;
export const allConnectors = (): Connector[] => [...registry.values()];

// Tests swap the list for fixtures (src/lib/connectors/__fixtures__/), and put it back after.
export function useConnectorsForTests(connectors: readonly Connector[] | null): void {
  registry = buildRegistry(connectors ?? CONNECTORS);
}

export type Unavailable =
  // CONNECTORS isn't "1".
  | "off"
  // KILL_CONNECTORS, or this id in CONNECTORS_KILLED.
  | "killed"
  // A real connector not turned on in REAL_CONNECTORS.
  | "switched_off"
  // A trial person never reaches a real connector.
  | "trial"
  // A sandbox adapter is only for sample data, a real connector only for real data.
  | "sandbox_for_samples"
  | "real_for_real"
  // A personalized investment or tax recommendation for a real person, before HUMAN_REVIEW_READY.
  | "needs_review";

export type Who = { userId: string; sampleData: boolean };

// Why this connector can't be used for this person now, or null when it can. Pure: the caller works
// out whether their data is sample data (onSampleDataOnly).
export function whyUnavailable(
  connector: Pick<Connector, "id" | "sandbox" | "recommends">,
  who: Who,
  env: Record<string, string | undefined> = process.env,
): Unavailable | null {
  if (!connectorsOn(env)) return "off";
  if (killed("connectors") || connectorsKilledByEnv(env).has(connector.id)) return "killed";
  if (connector.sandbox) return who.sampleData ? null : "sandbox_for_samples";
  if (isTrialUser(who.userId)) return "trial";
  if (who.sampleData) return "real_for_real";
  if (REAL_CONNECTORS[connector.id] !== true) return "switched_off";
  // Here, so the connections page, consent, uploads and the pipeline all hold it back alike.
  return connector.recommends && !HUMAN_REVIEW_READY ? "needs_review" : null;
}

// Whether acting through it may move real money: only a real connector, only once money movement is
// on in code. A sandbox adapter's "payment" moves nothing.
export const mayMoveRealMoney = (connector: Pick<Connector, "sandbox" | "movesMoney">): boolean =>
  !connector.sandbox && connector.movesMoney && REAL_MONEY_MOVEMENT;
