"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { COVERAGE_FIELDS, GAP_KEYS, isPolicyKind, type GapKey } from "@/config/insurance";
import {
  HouseholdFactsError,
  dismissGap,
  saveHousehold,
  type HouseholdInput,
} from "@/lib/insurance/household";
import {
  PolicyError,
  addPolicy,
  removePolicy,
  updatePolicy,
  type PolicyInput,
} from "@/lib/insurance/policies";
import { ReadingError, confirmReading, dismissReading } from "@/lib/insurance/readings";
import {
  CoverChangeError,
  applyCoverEvent,
  dismissCoverEvent,
} from "@/lib/insurance/cover-changes";
import { parseCoverEventRef } from "@/lib/jane-agent/insurance/cover-words";
import {
  NegotiationError,
  callCarrier,
  declineNegotiation,
  negotiationsDue,
} from "@/lib/insurance/negotiate";
import { SavingError, applySaving, dismissSaving } from "@/lib/insurance/savings";
import { RiskError, answerRisk } from "@/lib/insurance/risks";
import {
  FamilyError,
  addPerson,
  removePerson,
  setCovered,
  setShared,
} from "@/lib/insurance/family";
import { PickError, pickOption } from "@/lib/insurance/need/pick";
import type { NeedKind } from "@/lib/insurance/need/types";
import { requireUser } from "@/lib/session";

// Insurance (spec step 102). A save goes back to /insurance with ?saved=, so the
// confirmation shows on the freshly loaded profile.

export type PolicyState = { message: string; input: PolicyInput } | null;
export type HouseholdState = { message: string; input: HouseholdInput } | null;

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");

function policyInputOf(formData: FormData): PolicyInput {
  const kind = text(formData, "kind");
  const coverage: Record<string, string> = {};
  if (isPolicyKind(kind)) {
    for (const field of COVERAGE_FIELDS[kind]) {
      coverage[field.key] = text(formData, `coverage.${field.key}`);
    }
  }
  return {
    kind,
    carrier: text(formData, "carrier"),
    premium: text(formData, "premium"),
    premiumFrequency: text(formData, "premiumFrequency"),
    deductible: text(formData, "deductible"),
    renewalDate: text(formData, "renewalDate"),
    termMonths: text(formData, "termMonths"),
    covers: text(formData, "covers"),
    coverage,
  };
}

function refreshOthers() {
  revalidatePath("/money");
  revalidatePath("/chat");
}

export async function savePolicy(_previous: PolicyState, formData: FormData): Promise<PolicyState> {
  const user = await requireUser();
  const policyId = text(formData, "policyId");
  const input = policyInputOf(formData);
  try {
    if (policyId) await updatePolicy(user.id, policyId, input);
    else await addPolicy(user.id, input);
  } catch (error) {
    if (error instanceof PolicyError) return { message: error.message, input };
    throw error;
  }
  // A policy just confirmed (or added) whose premium went up shows under "Renewals going up"
  // at once, with its call, instead of after the night's run (gap audit: the "ask your insurer
  // for a better rate" suggestion led here to nothing for a found policy).
  await negotiationsDue(user.id).catch((error) =>
    console.error("Renewal check after saving a policy failed", { error: String(error) }),
  );
  refreshOthers();
  redirect(`/insurance?saved=${policyId ? "updated" : "added"}`);
}

// Spec step 151: a policy read from a document, confirmed as the person left the fields.
export async function confirmReadingForm(
  _previous: PolicyState,
  formData: FormData,
): Promise<PolicyState> {
  const user = await requireUser();
  const input = policyInputOf(formData);
  try {
    await confirmReading(user.id, text(formData, "readingId"), { input });
  } catch (error) {
    if (error instanceof ReadingError) return { message: error.message, input };
    throw error;
  }
  refreshOthers();
  redirect("/insurance?saved=read");
}

export async function dismissReadingForm(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await dismissReading(user.id, text(formData, "readingId"));
  } catch (error) {
    if (!(error instanceof ReadingError)) throw error;
  }
  refreshOthers();
  redirect("/insurance");
}

// Spec step 154: a life event's prepared cover changes, made or left as they are.
export async function applyChanges(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = parseCoverEventRef(text(formData, "coverEvent"));
  if (parsed) await applyCoverEvent(user.id, parsed.event, parsed.eventKey);
  refreshOthers();
  redirect("/insurance?saved=changes");
}

export async function dismissChanges(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = parseCoverEventRef(text(formData, "coverEvent"));
  try {
    if (parsed) await dismissCoverEvent(user.id, parsed.event, parsed.eventKey);
  } catch (error) {
    if (!(error instanceof CoverChangeError)) throw error;
  }
  refreshOthers();
  redirect("/insurance");
}

// Spec step 155: the renewal call, on the person's tap, or not.
export async function callRenewal(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await callCarrier(user.id, text(formData, "negotiationId"));
  } catch (error) {
    if (!(error instanceof NegotiationError)) throw error;
  }
  refreshOthers();
  redirect("/insurance?saved=called#renewals");
}

export async function skipRenewal(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await declineNegotiation(user.id, text(formData, "negotiationId"));
  } catch (error) {
    if (!(error instanceof NegotiationError)) throw error;
  }
  refreshOthers();
  redirect("/insurance");
}

// Spec step 196: a cheaper way to pay for the same cover, on the person's tap, or not.
export async function applyOneSaving(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await applySaving(user.id, text(formData, "savingId"));
  } catch (error) {
    if (!(error instanceof SavingError)) throw error;
  }
  refreshOthers();
  redirect("/insurance?saved=saving#savings");
}

export async function skipSaving(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await dismissSaving(user.id, text(formData, "savingId"));
  } catch (error) {
    if (!(error instanceof SavingError)) throw error;
  }
  refreshOthers();
  redirect("/insurance");
}

// Spec step 197: a question about how they live, answered on the page.
export async function answerRiskForm(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await answerRisk(user.id, text(formData, "riskId"), text(formData, "answer") === "yes");
  } catch (error) {
    if (!(error instanceof RiskError)) throw error;
  }
  refreshOthers();
  redirect("/insurance?saved=risk");
}

// Spec step 198: the whole household's cover.
async function household(run: () => Promise<unknown>): Promise<never> {
  let error: string | null = null;
  try {
    await run();
  } catch (e) {
    if (!(e instanceof FamilyError)) throw e;
    error = e.message;
  }
  refreshOthers();
  redirect(
    error ? `/insurance?family=${encodeURIComponent(error)}#household` : "/insurance#household",
  );
}

export async function addPersonForm(formData: FormData): Promise<void> {
  const user = await requireUser();
  await household(() =>
    addPerson(user.id, {
      name: text(formData, "name"),
      relation: text(formData, "relation"),
      driver: text(formData, "driver") === "on",
      age: text(formData, "age"),
    }),
  );
}

export async function removePersonForm(formData: FormData): Promise<void> {
  const user = await requireUser();
  await household(() => removePerson(user.id, text(formData, "name")));
}

export async function setSharedForm(formData: FormData): Promise<void> {
  const user = await requireUser();
  await household(() =>
    setShared(user.id, text(formData, "policyId"), text(formData, "shared") === "yes"),
  );
}

export async function setCoveredForm(formData: FormData): Promise<void> {
  const user = await requireUser();
  await household(() =>
    setCovered(
      user.id,
      text(formData, "policyId"),
      text(formData, "name"),
      text(formData, "covered") === "yes",
    ),
  );
}

// Spec step 276: choosing an option queues it for the team (one tap, never twice).
export async function pickCoverForm(formData: FormData): Promise<void> {
  const user = await requireUser();
  const need = text(formData, "need") as NeedKind;
  const policy = text(formData, "policy");
  let message: string;
  try {
    const picked = await pickOption(user.id, need, text(formData, "option"), {
      policyId: policy || undefined,
    });
    message = picked.newCover
      ? "Got it. My team will add that cover for you and tell you when it's done."
      : "Got it. My team will change that on your policy and tell you when it's done.";
  } catch (e) {
    if (!(e instanceof PickError)) throw e;
    message = e.message;
  }
  refreshOthers();
  redirect(`/insurance?picked=${encodeURIComponent(message)}#options`);
}

export async function deletePolicy(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    await removePolicy(user.id, text(formData, "policyId"));
  } catch (error) {
    if (error instanceof PolicyError) redirect("/insurance");
    throw error;
  }
  refreshOthers();
  redirect("/insurance?saved=removed");
}

export async function saveHouseholdFacts(
  _previous: HouseholdState,
  formData: FormData,
): Promise<HouseholdState> {
  const user = await requireUser();
  const input: HouseholdInput = {
    housing: text(formData, "housing"),
    vehicles: text(formData, "vehicles"),
    dependants: text(formData, "dependants"),
    pets: text(formData, "pets"),
  };
  try {
    await saveHousehold(user.id, input);
  } catch (error) {
    if (error instanceof HouseholdFactsError) return { message: error.message, input };
    throw error;
  }
  refreshOthers();
  redirect("/insurance?saved=household");
}

export async function notNeeded(formData: FormData): Promise<void> {
  const user = await requireUser();
  const gap = text(formData, "gap");
  if ((GAP_KEYS as readonly string[]).includes(gap)) await dismissGap(user.id, gap as GapKey);
  refreshOthers();
  redirect("/insurance?saved=gap");
}
