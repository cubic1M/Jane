import type { PersonId } from "@/config/people";
import type { PersonExtra } from "../demo-people";

// What the controller round (Phase AP, steps 238–244) adds to the sample people's lives so its
// detectors have signals to find. Keys start "ap-".

export const CONTROLLER_EXTRAS: Partial<Record<PersonId, PersonExtra>> = {
  // Priya (spec step 243): fibre internet started about eleven months ago on an
  // introductory price that ends in six to ten weeks, and a yearly cloud-storage plan paid
  // once, about eleven months ago, that renews in about six weeks too.
  equity: {
    monthly: [
      {
        key: "ap-fiber",
        account: "checking",
        name: "AT&T FIBER",
        merchant: "AT&T",
        category: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
        amount: 55,
        days: [6],
        span: { from: -325 },
      },
    ],
    once: [
      {
        key: "ap-icloud-annual",
        account: "card",
        name: "ICLOUD+ ANNUAL PLAN",
        merchant: "iCloud",
        category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        amount: 99.99,
        offsets: [-320],
      },
    ],
  },
};
