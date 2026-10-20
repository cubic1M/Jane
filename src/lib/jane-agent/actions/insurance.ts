import { GAP_KEYS, type GapKey } from "@/config/insurance";
import { dismissGap } from "@/lib/insurance/household";
import { AcceptShopError, acceptShop } from "@/lib/insurance/accept";
import { requestQuotes } from "@/lib/insurance/quotes";
import { markCheckupSeen } from "@/lib/insurance/checkups";
import {
  BenefitError,
  answerQuestion,
  confirmAllFound,
  nextQuestion,
  type BenefitAnswer,
  type BenefitQuestion,
} from "@/lib/insurance/benefits";
import { QUESTIONS } from "../insurance/benefit-words";
import { ClaimError, closeClaim, markStepDone, nextStep, startClaim } from "@/lib/insurance/claims";
import { trackerActions, trackerBody } from "../insurance/claim-words";
import { declineShop } from "@/lib/insurance/shop";
import { quotesReply } from "../insurance/quotes";
import { ReadingError, confirmReading, dismissReading, getReading } from "@/lib/insurance/readings";
import {
  LifeError,
  answerLifeQuestion,
  buyLife,
  dismissLife,
  latestLife,
  saveDependants,
  sizeLife,
  startLifeApplication,
  submitLifeApplication,
} from "@/lib/insurance/life";
import { nextLifeQuestion } from "@/lib/insurance/life-underwriting";
import {
  CoverChangeError,
  applyCoverEvent,
  dismissCoverEvent,
} from "@/lib/insurance/cover-changes";
import { listPolicies } from "@/lib/insurance/policies";
import { doneNote, parseCoverEventRef } from "../insurance/cover-words";
import { NegotiationError, callCarrier, declineNegotiation } from "@/lib/insurance/negotiate";
import { fileClaim as fileClaimNow } from "@/lib/insurance/claim-filing";
import { callResultBody } from "../insurance/done-by-jane-words";
import {
  SavingError,
  applySaving,
  dismissSaving,
  listSavings,
  type Saving,
} from "@/lib/insurance/savings";
import { appliedNote, sameCover } from "../insurance/saving-words";
import {
  askingStep,
  boughtNote,
  decisionStep,
  NOT_NEEDED,
  sizedActions,
  sizedBody,
} from "../insurance/life-words";
import { ChatActionError, answeredElsewhere, type ActionHandler } from "./handler";

// Insurance buttons (spec Phase X), through the same code as /insurance.

// "I don't need it" on a coverage gap: never brought up again, here or on the page.
export const insuranceGapNo: ActionHandler = {
  id: "insurance.gap_no",
  on: "open",
  async run({ userId, message, action, client }) {
    const gap = message.refs.insuranceGap;
    if (!gap || !(GAP_KEYS as readonly string[]).includes(gap)) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    if (!(await dismissGap(userId, gap as GapKey, { client }))) {
      throw answeredElsewhere("You've already told me you don't need it.");
    }
    return { answeredWith: action.label, note: "OK. I won't bring it up again." };
  },
};

// "Compare quotes" on an answer about one policy (spec step 103): asks the insurance
// partner now, through the same code as the quotes page, and says what came back. Asking
// buys nothing.
export const insuranceQuotes: ActionHandler = {
  id: "insurance.quotes",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { policyId } = message.refs;
    if (!policyId) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    const result = await requestQuotes(userId, policyId, { client, now });
    if (result.kind === "unavailable" && result.reason === "not_found") {
      throw answeredElsewhere("That policy isn't on your insurance anymore.");
    }
    const reply = quotesReply(result);
    return { answeredWith: action.label, note: reply.body, actions: reply.actions };
  },
};

// Yes on Jane's pick (spec step 104): the one tap. Recorded as a yes on the policy's
// insurance_reshop finding, with an action for the switch (src/lib/insurance/accept.ts).
export const insuranceShopYes: ActionHandler = {
  id: "insurance.shop_yes",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { insuranceShopId } = message.refs;
    if (!insuranceShopId) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    try {
      const { actionId, agentJobId } = await acceptShop(userId, insuranceShopId, {
        client,
        now,
      });
      return {
        answeredWith: action.label,
        note: "Done. I'm switching you now: your current policy stays in place until the new one's first payment goes through, then I cancel it from the same day.",
        refs: { ...message.refs, actionId },
        agentJobIds: [agentJobId],
      };
    } catch (error) {
      if (error instanceof AcceptShopError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// Not now: keeps the current policy this time. Jane shops it again before the next renewal
// or if the price goes up.
export const insuranceShopNo: ActionHandler = {
  id: "insurance.shop_no",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { insuranceShopId } = message.refs;
    if (!insuranceShopId) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    if (!(await declineShop(userId, insuranceShopId, { client, now }))) {
      throw answeredElsewhere("This one's already been answered.");
    }
    return {
      answeredWith: action.label,
      note: "OK, you'll keep your current policy. I'll shop it again before it next renews.",
    };
  },
};

// "Got it" on the coverage checkup (spec step 106): seen, so Jane doesn't bring it up again.
export const insuranceCheckupSeen: ActionHandler = {
  id: "insurance.checkup_seen",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { insuranceCheckupId } = message.refs;
    if (!insuranceCheckupId) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    if (!(await markCheckupSeen(userId, insuranceCheckupId, { client, now }))) {
      throw answeredElsewhere("You've already seen this checkup.");
    }
    return {
      answeredWith: action.label,
      note: "OK. I'll check your cover again in a year, or sooner if your life changes.",
    };
  },
};

// Spec step 107: "Start a claim tracker" under the claims guide. The same message becomes
// the tracker, one step at a time, like a guided flow.
export const insuranceClaimStart: ActionHandler = {
  id: "insurance.claim_start",
  on: "open",
  async run({ userId, message, client, now }) {
    const wanted = message.refs.claim;
    if (!wanted) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    try {
      const claim = await startClaim(
        userId,
        { policyId: wanted.policyId, kind: wanted.kind, event: wanted.event, happenedOn: "" },
        { client, now },
      );
      return {
        status: "open",
        answeredWith: null,
        body: trackerBody(claim),
        refs: { ...message.refs, claimId: claim.id, claimStep: nextStep(claim)?.key },
        actions: trackerActions(claim),
      };
    } catch (error) {
      if (error instanceof ClaimError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// "Done" on the claim's next step: marked done (never removed), and the message moves on.
export const insuranceClaimStep: ActionHandler = {
  id: "insurance.claim_step",
  on: "open",
  async run({ userId, message, client, now }) {
    const { claimId, claimStep } = message.refs;
    if (!claimId || !claimStep) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    try {
      const { claim } = await markStepDone(userId, claimId, claimStep, { client, now });
      return {
        status: "open",
        answeredWith: null,
        body: trackerBody(claim),
        refs: { ...message.refs, claimStep: nextStep(claim)?.key },
        actions: trackerActions(claim),
      };
    } catch (error) {
      if (error instanceof ClaimError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

// "Close the claim" once every step is done and the person was paid.
export const insuranceClaimClose: ActionHandler = {
  id: "insurance.claim_close",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { claimId } = message.refs;
    if (!claimId) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    try {
      await closeClaim(userId, claimId, { client, now });
    } catch (error) {
      if (error instanceof ClaimError) throw answeredElsewhere(error.message);
      throw error;
    }
    return { answeredWith: action.label, note: "Closed. I'm glad it's sorted." };
  },
};

// Spec step 150: "Yes, they're right" on the benefits Jane found on the pay stub. The tap is
// the confirmation: only now do they count.
export const benefitsConfirmAll: ActionHandler = {
  id: "benefits.confirm_all",
  on: "open",
  async run({ userId, action, client }) {
    const n = await confirmAllFound(userId, { client });
    if (n === 0) throw answeredElsewhere("You've already answered these.");
    return {
      answeredWith: action.label,
      note: `Done. ${n === 1 ? "It's" : `All ${n} are`} on your insurance now, and I'll compare them with buying the same cover yourself.`,
    };
  },
};

// The guided questions: each answer goes through the benefits code, and the same message
// moves on to the next question, or says it's done.
const answer = (
  id: ActionHandler["id"],
  question: BenefitQuestion | null,
  value: BenefitAnswer,
): ActionHandler => ({
  id,
  on: "open",
  async run({ userId, message, action, client, now }) {
    const asked = (question ?? message.refs.benefitQuestion) as BenefitQuestion | undefined;
    if (!asked || (question && message.refs.benefitQuestion !== question)) {
      throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    }
    try {
      const next = nextQuestion(await answerQuestion(userId, asked, value, { client, now }));
      if (next) {
        return {
          status: "open",
          answeredWith: null,
          body: QUESTIONS[next].body,
          refs: { ...message.refs, benefitQuestion: next },
          actions: [
            ...QUESTIONS[next].actions,
            { id: "open", label: "Your benefits", kind: "link", href: "/insurance/benefits" },
          ],
        };
      }
      return {
        answeredWith: action.label,
        note: "Thanks. That's everything I needed about your job's cover.",
      };
    } catch (error) {
      if (error instanceof BenefitError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
});

export const benefitsLife1x = answer("benefits.life_1x", "life", "1x");
export const benefitsLife2x = answer("benefits.life_2x", "life", "2x");
export const benefitsLifeNone = answer("benefits.life_none", "life", "none");
export const benefitsDisabilityYes = answer("benefits.disability_yes", "disability", "yes");
export const benefitsDisabilityNone = answer("benefits.disability_none", "disability", "none");
export const benefitsUnsure = answer("benefits.unsure", null, "unsure");

// Spec step 151: a policy read from a document. Confirm saves it as read (the page is for
// fixing a field first); Not a policy saves nothing.
export const readingConfirm: ActionHandler = {
  id: "reading.confirm",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.readingId;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    const reading = await getReading(userId, id, { client });
    try {
      await confirmReading(userId, id, { client, now });
    } catch (error) {
      if (!(error instanceof ReadingError)) throw error;
      if (reading?.status !== "waiting") throw answeredElsewhere(error.message);
      throw new ChatActionError("failed", `${error.message} Tap Fix something to add it.`);
    }
    return {
      answeredWith: action.label,
      note: reading?.policyId
        ? "Done. Your policy is up to date with the renewal notice."
        : "Done. It's on your insurance now.",
    };
  },
};

export const readingDismiss: ActionHandler = {
  id: "reading.dismiss",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.readingId;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    try {
      await dismissReading(userId, id, { client, now });
    } catch (error) {
      if (error instanceof ReadingError) throw answeredElsewhere(error.message);
      throw error;
    }
    return { answeredWith: action.label, note: "Okay, I've left it off your insurance." };
  },
};

// Spec step 153: life insurance, sized and applied for (demo advice). Each handler moves the
// same message along: the dependants answer sizes the cover; Apply starts the health
// questions; Send goes to the carrier; Buy takes the offer. Nothing commits without a tap.
const lifeId = (message: { refs: { lifeApplicationId?: string } }) => {
  const id = message.refs.lifeApplicationId;
  if (!id) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
  return id;
};

async function lifeStep<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LifeError) throw answeredElsewhere(error.message);
    throw error;
  }
}

const dependants = (id: ActionHandler["id"], n: number): ActionHandler => ({
  id,
  on: "open",
  async run({ userId, message, action, client, now }) {
    await saveDependants(userId, n, { client });
    const sized = await sizeLife(userId, { client, now });
    if (sized.kind === "sized") {
      const asOf = now.toISOString().slice(0, 10);
      return {
        status: "open",
        answeredWith: null,
        body: sizedBody(sized.application, asOf),
        refs: { ...message.refs, lifeApplicationId: sized.application.id, advice: true },
        actions: sizedActions(sized.application, asOf),
      };
    }
    return {
      answeredWith: action.label,
      note:
        sized.kind === "not_needed"
          ? NOT_NEEDED[sized.reason]
          : "Thanks, I've noted that on your insurance.",
    };
  },
});

export const lifeCoverDependants0 = dependants("lifecover.dependants_0", 0);
export const lifeCoverDependants1 = dependants("lifecover.dependants_1", 1);
export const lifeCoverDependants2 = dependants("lifecover.dependants_2", 2);
export const lifeCoverDependants3 = dependants("lifecover.dependants_3", 3);

export const lifeCoverApply: ActionHandler = {
  id: "lifecover.apply",
  on: "open",
  async run({ userId, message, client, now }) {
    const application = await lifeStep(() =>
      startLifeApplication(userId, lifeId(message), null, { client, now }),
    );
    return { status: "open", answeredWith: null, ...askingStep(application), refs: message.refs };
  },
};

const lifeAnswer = (id: ActionHandler["id"], yes: boolean): ActionHandler => ({
  id,
  on: "open",
  async run({ userId, message, client }) {
    const application = await lifeStep(async () => {
      const current = await latestLife(userId, { client });
      const key = current?.id === lifeId(message) ? nextLifeQuestion(current.answers) : null;
      if (!key) throw new LifeError("That one's already been answered.");
      return answerLifeQuestion(userId, current!.id, key, yes, { client });
    });
    return { status: "open", answeredWith: null, ...askingStep(application), refs: message.refs };
  },
});

export const lifeCoverYes = lifeAnswer("lifecover.yes", true);
export const lifeCoverNo = lifeAnswer("lifecover.no", false);

export const lifeCoverSubmit: ActionHandler = {
  id: "lifecover.submit",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const application = await lifeStep(() =>
      submitLifeApplication(userId, lifeId(message), { client, now }),
    );
    const step = decisionStep(application);
    if (application.status === "offered") {
      return { status: "open", answeredWith: null, ...step, refs: message.refs };
    }
    return { answeredWith: action.label, note: step.body };
  },
};

export const lifeCoverBuy: ActionHandler = {
  id: "lifecover.buy",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = lifeId(message);
    await lifeStep(() => buyLife(userId, id, { client, now }));
    const application = await latestLife(userId, { client });
    return {
      answeredWith: action.label,
      note: application ? boughtNote(application) : "Done. It's on your insurance.",
    };
  },
};

export const lifeCoverDismiss: ActionHandler = {
  id: "lifecover.dismiss",
  on: "open",
  async run({ userId, message, action, client }) {
    await lifeStep(() => dismissLife(userId, lifeId(message), { client }));
    return {
      answeredWith: action.label,
      note: "Okay. I won't bring it up again unless your numbers change.",
    };
  },
};

// Spec step 154: cover changes after a life event. One tap makes every prepared change (with
// the carrier through the partner, or marks them done when the person made them); Not now
// leaves everything as it is.
const coverOf = (message: { refs: { coverEvent?: string } }) => {
  const parsed = parseCoverEventRef(message.refs.coverEvent);
  if (!parsed) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
  return parsed;
};

export const coverApply: ActionHandler = {
  id: "cover.apply",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { event, eventKey } = coverOf(message);
    // The prices before, for saying what changed.
    const before = await listPolicies(userId, { client });
    const made = await applyCoverEvent(userId, event, eventKey, { client, now });
    if (made.length === 0) throw answeredElsewhere("You've already answered this.");
    return { answeredWith: action.label, note: doneNote(made, before) };
  },
};

export const coverDismiss: ActionHandler = {
  id: "cover.dismiss",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { event, eventKey } = coverOf(message);
    try {
      await dismissCoverEvent(userId, event, eventKey, { client, now });
    } catch (error) {
      if (error instanceof CoverChangeError) throw answeredElsewhere(error.message);
      throw error;
    }
    return { answeredWith: action.label, note: "Okay, I've left your insurance as it is." };
  },
};

// Spec step 155: the renewal call, on the person's tap; and filing the claim draft they've
// just read.
export const renewalCall: ActionHandler = {
  id: "renewal.call",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.negotiationId;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    let result;
    try {
      result = await callCarrier(userId, id, { client, now });
    } catch (error) {
      if (error instanceof NegotiationError) throw answeredElsewhere(error.message);
      throw error;
    }
    const policy = (await listPolicies(userId, { client })).find((p) => p.id === result.policyId);
    return { answeredWith: action.label, note: callResultBody(result, policy) };
  },
};

export const renewalNo: ActionHandler = {
  id: "renewal.no",
  on: "open",
  async run({ userId, message, action, client }) {
    const id = message.refs.negotiationId;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    try {
      await declineNegotiation(userId, id, { client });
    } catch (error) {
      if (error instanceof NegotiationError) throw answeredElsewhere(error.message);
      throw error;
    }
    return {
      answeredWith: action.label,
      note: "Okay, I won't call. The new price applies when it renews.",
    };
  },
};

export const claimFile: ActionHandler = {
  id: "claim.file",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.claimId;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    let claim;
    try {
      claim = await fileClaimNow(userId, id, { client, now });
    } catch (error) {
      if (error instanceof ClaimError) throw answeredElsewhere(error.message);
      throw error;
    }
    return {
      answeredWith: action.label,
      note: `Filed. ${claim.carrier ?? "Your insurer"} has your claim, number ${claim.claimNumber}. I'll tell you here as it moves.`,
    };
  },
};

// Spec step 196: paying less for the same cover. One tap applies the savings that keep the
// cover (through the partner); a higher deductible is its own tap. Nothing changes without it.
async function savingStep<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SavingError) throw answeredElsewhere(error.message);
    throw error;
  }
}

export const savingApplyAll: ActionHandler = {
  id: "saving.apply_all",
  on: "open",
  async run({ userId, action, client, now }) {
    const offered = sameCover(await listSavings(userId, { client, status: "offered" }));
    if (offered.length === 0) throw answeredElsewhere("You've already answered this.");
    const done: Saving[] = [];
    for (const s of offered) {
      try {
        done.push(await applySaving(userId, s.id, { client, now }));
      } catch (error) {
        // One that no longer applies doesn't stop the others.
        if (!(error instanceof SavingError)) throw error;
      }
    }
    if (done.length === 0) throw answeredElsewhere("Those don't apply anymore.");
    return { answeredWith: action.label, note: appliedNote(done) };
  },
};

export const savingApply: ActionHandler = {
  id: "saving.apply",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.savingId;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    const done = await savingStep(() => applySaving(userId, id, { client, now }));
    return { answeredWith: action.label, note: appliedNote([done]) };
  },
};

export const savingNo: ActionHandler = {
  id: "saving.no",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const ids = message.refs.savingId
      ? [message.refs.savingId]
      : sameCover(await listSavings(userId, { client, status: "offered" })).map((s) => s.id);
    if (ids.length === 0) throw answeredElsewhere("You've already answered this.");
    for (const id of ids) await savingStep(() => dismissSaving(userId, id, { client, now }));
    return { answeredWith: action.label, note: "Okay, I won't bring those up again." };
  },
};
