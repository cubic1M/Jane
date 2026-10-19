import type { PolicyKind } from "./insurance";

// The claims helper (spec step 107): for each kind of policy, what can happen, what to do
// right away, what to collect, and the steps of a claim with when each is due (days after
// it happened). Plain guidance, not legal advice. Step keys are stored on each claim
// (insurance_claims.steps), so never rename one; add a new key.
//
// What Jane does by herself, at every autopilot level: she keeps the tracker and reminds
// the person of the next step when it's due. She never files a claim or talks to the
// insurer for them: the claim is the person's own statement.

export type ClaimStep = { key: string; label: string; dueDays: number };

export type ClaimGuide = {
  // What happened, by key, as the person would say it.
  events: Readonly<Record<string, string>>;
  now: readonly string[];
  collect: readonly string[];
  steps: readonly ClaimStep[];
};

const FILE = {
  key: "file",
  label: "Call your insurer, or file the claim online, and write down the claim number",
  dueDays: 1,
};
const PAID = {
  key: "paid",
  label: "Check the payment matches what was agreed, then close the claim",
  dueDays: 45,
};

export const CLAIM_GUIDES: Record<PolicyKind, ClaimGuide> = {
  auto: {
    events: {
      accident: "A car accident",
      theft: "My car was stolen or broken into",
      damage: "Weather or glass damage",
    },
    now: [
      "Make sure everyone is safe. Call 911 if anyone is hurt.",
      "If you can, move out of traffic and turn on your hazard lights.",
      "Don't say whose fault it was. Swap names, phone numbers, insurers and plate numbers.",
    ],
    collect: [
      "Photos of every car, the damage, the scene and the road",
      "The other driver's name, insurer and policy number",
      "Plate numbers, and names and numbers of anyone who saw it",
      "The police report number, if the police came",
    ],
    steps: [
      {
        key: "police",
        label: "Get the police report number (for theft, or if anyone was hurt)",
        dueDays: 1,
      },
      FILE,
      {
        key: "photos",
        label: "Send your photos and the other driver's details to the adjuster",
        dueDays: 3,
      },
      { key: "estimate", label: "Get a repair estimate, or the insurer's appraisal", dueDays: 7 },
      {
        key: "repair",
        label: "Book the repair, and keep the receipts for any rental car",
        dueDays: 21,
      },
      PAID,
    ],
  },
  home: {
    events: {
      break_in: "A break-in",
      damage: "Fire, water or storm damage",
      theft: "Something was stolen",
    },
    now: [
      "Get somewhere safe. Call 911 if anyone is in danger or someone may still be inside.",
      "If it's safe, stop more damage: shut off the water, cover a broken window or roof.",
      "Don't throw anything damaged away until the adjuster has seen it.",
    ],
    collect: [
      "Photos and video of the damage before anything is cleaned up",
      "A list of what's damaged or missing, with roughly what each cost",
      "Receipts for anything you buy to stop more damage or to stay elsewhere",
      "The police report number, for a break-in or theft",
    ],
    steps: [
      {
        key: "police",
        label: "Report a break-in or theft to the police and get the report number",
        dueDays: 1,
      },
      FILE,
      { key: "list", label: "Send the list of what's damaged or missing, with photos", dueDays: 7 },
      {
        key: "adjuster",
        label: "Meet the adjuster, and keep repair and hotel receipts",
        dueDays: 14,
      },
      PAID,
    ],
  },
  renters: {
    events: {
      break_in: "A break-in",
      damage: "Fire, water or storm damage",
      theft: "Something was stolen",
    },
    now: [
      "Get somewhere safe. Call 911 if anyone is in danger or someone may still be inside.",
      "Tell your landlord: the building is theirs to repair and insure.",
      "Don't throw anything damaged away until the adjuster has seen it.",
    ],
    collect: [
      "Photos and video of your damaged things before anything is cleaned up",
      "A list of what's damaged or missing, with roughly what each cost",
      "Receipts for a hotel or meals if you can't stay at home",
      "The police report number, for a break-in or theft",
    ],
    steps: [
      {
        key: "police",
        label: "Report a break-in or theft to the police and get the report number",
        dueDays: 1,
      },
      { key: "landlord", label: "Tell your landlord in writing", dueDays: 1 },
      FILE,
      { key: "list", label: "Send the list of what's damaged or missing, with photos", dueDays: 7 },
      PAID,
    ],
  },
  life: {
    events: { death: "Someone covered has died" },
    now: [
      "There's no rush with the insurance. Take care of yourself and your family first.",
      "Most policies can be claimed months later; nothing here needs doing today.",
    ],
    collect: [
      "Certified copies of the death certificate (the funeral home can order several)",
      "The policy number, from the policy or old payments",
      "Each beneficiary's ID and bank details",
    ],
    steps: [
      { key: "certificate", label: "Order certified copies of the death certificate", dueDays: 14 },
      // No rush: a few weeks is fine.
      { ...FILE, dueDays: 21 },
      { key: "form", label: "Send the insurer's claim form with a death certificate", dueDays: 30 },
      PAID,
    ],
  },
  pet: {
    events: { vet: "A vet visit for an illness or injury" },
    now: ["Get your pet cared for first. The claim comes after the visit."],
    collect: ["The vet's itemized invoice", "Your pet's medical records for the visit"],
    steps: [
      {
        key: "invoice",
        label: "Pay the vet and ask for an itemized invoice and the records",
        dueDays: 1,
      },
      {
        key: "submit",
        label: "Send the claim with the invoice in your insurer's app or site",
        dueDays: 7,
      },
      PAID,
    ],
  },
  health: {
    events: { bill: "A medical bill I didn't expect" },
    now: ["Don't pay a surprise bill straight away. Check what your insurer says you owe first."],
    collect: [
      "The itemized bill from the doctor or hospital",
      "The explanation of benefits from your insurer",
    ],
    steps: [
      {
        key: "eob",
        label: "Compare the bill with your insurer's explanation of benefits",
        dueDays: 7,
      },
      {
        key: "call",
        label: "Call your insurer about anything denied or that doesn't match",
        dueDays: 14,
      },
      { key: "appeal", label: "Ask for a review if they still deny it, in writing", dueDays: 30 },
      PAID,
    ],
  },
  other: {
    events: { other: "Something else happened" },
    now: ["Make sure everyone is safe first. Call 911 in an emergency."],
    collect: ["Photos of what happened", "Receipts for anything you had to pay for because of it"],
    steps: [
      FILE,
      { key: "documents", label: "Send the insurer what they ask for", dueDays: 7 },
      PAID,
    ],
  },
};

// When the insurer's claims number isn't known (not in the stand-in catalog), where to find it.
export const CLAIM_CONTACT_FALLBACK =
  "Your insurer's claims number is on your insurance card, your policy documents and their app or website.";

// A reminder for the next step once it's due, then again this many days later while it
// waits. Claims stay open until the person closes them: no step is ever dropped.
export const CLAIM_REMIND_EVERY_DAYS = 3;
export const MAX_CLAIM_NUMBER_LENGTH = 40;
